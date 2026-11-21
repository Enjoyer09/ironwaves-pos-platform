from datetime import timedelta
from decimal import Decimal as D
import pytest
from fastapi import HTTPException
from sqlalchemy import func
from app.models import InventoryItem, InventoryBatch, InventoryBatchMovement, InventoryValuation, AuditLog, FinanceTransaction
from app.routers import catalog, operations
from app.schemas import InventoryItemCreateIn, InventoryRestockIn, InventoryLossIn
from app.services.inventory_batches import business_today, eligible
from app.gl import engine as gl
from test_gl_dual_mode_flows import db, tenant, ADMIN, ok


def item(db, tenant, name="Batch product", qty="0", cost="0", expiry_required=False):
    row = InventoryItem(tenant_id=tenant.id, name=name, unit="kg", stock_qty=D(qty), unit_cost=D(cost), min_limit=D("0"), expiry_required=expiry_required)
    db.add(row); db.commit()
    return row


def receive(db, tenant, row, qty="5", price="10", days=10, code="LOT", status="available", key=None):
    return catalog.restock_inventory_item(row.id, InventoryRestockIn(qty_added=D(qty), total_price=D(price),
        payment_source="cash", lot_code=code, expires_on=business_today()+timedelta(days=days) if days is not None else None,
        batch_status=status, idempotency_key=key), db=db, tenant=tenant, user=ADMIN)


def consume(db, tenant, row, qty):
    row.stock_qty -= D(qty)
    db.add(AuditLog(tenant_id=tenant.id, user="tester", action="INVENTORY_CONSUMED", details=__import__('json').dumps({"item_name": row.name, "qty_removed": qty})))
    db.commit()


def lots(db, tenant, row):
    return db.query(InventoryBatch).filter_by(tenant_id=tenant.id, item_id=row.id).all()


def test_fefo_earliest_expiry_before_fifo_and_unknown_last(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, days=20, code="LATER")
    receive(db, tenant, row, days=2, code="FIRST")
    receive(db, tenant, row, days=None, code="UNKNOWN")
    consume(db, tenant, row, "6")
    by_code = {b.lot_code: b.quantity_remaining for b in lots(db, tenant, row)}
    assert by_code == {"FIRST": D("0"), "LATER": D("4"), "UNKNOWN": D("5")}
    assert sum(by_code.values()) == row.stock_qty == D("9")
    assert db.query(InventoryBatchMovement).filter_by(item_id=row.id).count() == 5


def test_expired_and_quarantined_lots_never_sold_and_failure_atomic(db, tenant, monkeypatch):
    row = item(db, tenant)
    receive(db, tenant, row, days=1, code="EXPIRING")
    receive(db, tenant, row, days=10, code="QUARANTINE", status="quarantine")
    monkeypatch.setattr('app.services.inventory_batches.business_today', lambda: business_today()+timedelta(days=2))
    with pytest.raises(HTTPException) as exc:
        consume(db, tenant, row, "1")
    assert exc.value.status_code == 409
    db.rollback(); db.refresh(row)
    assert row.stock_qty == D("10")
    assert {b.quantity_remaining for b in lots(db, tenant, row)} == {D("5")}


def test_expiry_date_inclusive_and_expiry_required_blocks_unknown(db, tenant):
    row = item(db, tenant, expiry_required=True)
    with pytest.raises(HTTPException):
        receive(db, tenant, row, days=None)
    assert db.get(InventoryItem, row.id).stock_qty == D("0")
    receive(db, tenant, row, days=0)
    assert eligible(lots(db, tenant, row)[0], row)
    consume(db, tenant, row, "1")
    assert row.stock_qty == D("4")


def test_expired_receipt_only_quarantine_and_specific_batch_disposal(db, tenant):
    row = item(db, tenant)
    with pytest.raises(HTTPException):
        receive(db, tenant, row, days=-1, code="EXPIRED")
    receive(db, tenant, row, days=-1, code="EXPIRED", status="quarantine")
    receive(db, tenant, row, days=10, code="GOOD")
    expired = next(b for b in lots(db, tenant, row) if b.lot_code == "EXPIRED")
    catalog.record_inventory_loss(row.id, InventoryLossIn(qty_removed=D("5"), reason="Expired disposal", batch_id=expired.id, idempotency_key="dispose-expired-01"), db=db, tenant=tenant, user=ADMIN)
    assert expired.quantity_remaining == 0
    assert next(b for b in lots(db, tenant, row) if b.lot_code == "GOOD").quantity_remaining == D("5")
    assert row.stock_qty == D("5")
    ok(db, tenant.id)


def test_receipt_replay_creates_one_lot(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, key="lot-replay-0001")
    receive(db, tenant, row, key="lot-replay-0001")
    assert len(lots(db, tenant, row)) == 1
    assert row.stock_qty == D("5")
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, transaction_type="inventory_restock").count() == 1


def test_surplus_and_return_unknown_increases_quarantined(db, tenant):
    row = item(db, tenant, qty="3", cost="2")
    row.stock_qty += D("2"); db.commit()
    assert sum((b.quantity_remaining for b in lots(db, tenant, row) if b.status == "quarantine"), D("0")) == D("2")
    assert row.stock_qty == D("5")


def test_legacy_deficit_preserved_and_receipt_offsets_it(db, tenant):
    row = item(db, tenant, qty="-2", cost="0")
    receive(db, tenant, row, qty="5", price="0")
    assert sum((b.quantity_remaining for b in lots(db, tenant, row)), D("0")) == row.stock_qty == D("3")
    assert all(b.quantity_remaining >= 0 for b in lots(db, tenant, row))


def test_nrv_write_down_reversal_cap_and_subsequent_cogs(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, qty="10", price="20")
    before = gl.account_balance(db, tenant.id, gl.accounts_by_role(db, tenant.id)["inventory"])
    payload = catalog.InventoryValuationIn(nrv_unit_cost=D("1"), expected_qty=D("10"), expected_unit_cost=D("2"), reason="NRV decreased", idempotency_key="valuation-0001")
    first = catalog.value_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert first["amount"] == "10.00" and row.unit_cost == D("1") and row.cost_basis_unit_cost == D("2")
    assert gl.account_balance(db, tenant.id, gl.accounts_by_role(db, tenant.id)["inventory"]) == before-D("10")
    assert catalog.value_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)["replayed"]
    catalog.record_inventory_loss(row.id, InventoryLossIn(qty_removed=D("2"), reason="Physical loss"), db=db, tenant=tenant, user=ADMIN)
    assert row.stock_qty == D("8")
    reversal = payload.model_copy(update={"nrv_unit_cost": D("5"), "expected_qty": D("8"), "expected_unit_cost": D("1"), "idempotency_key": "valuation-0002"})
    result = catalog.value_inventory(row.id, reversal, db=db, tenant=tenant, user=ADMIN)
    assert result["amount"] == "8.00" and row.unit_cost == row.cost_basis_unit_cost == D("2")
    assert db.query(InventoryValuation).filter_by(item_id=row.id).count() == 2
    ok(db, tenant.id)
    report = catalog.reconcile_inventory(db=db, tenant=tenant, user=ADMIN)
    assert report["balanced"]


def test_receipt_after_impairment_weights_book_and_original_cost_separately(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, qty="10", price="20")
    catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D("1"), expected_qty=D("10"), expected_unit_cost=D("2"), reason="NRV decrease", idempotency_key="basis-valuation-01"), db=db, tenant=tenant, user=ADMIN)
    receive(db, tenant, row, qty="10", price="40")
    assert row.unit_cost == D("2.5000")
    assert row.cost_basis_unit_cost == D("3.0000")
    assert catalog.reconcile_inventory(db=db, tenant=tenant, user=ADMIN)["balanced"]


def test_batch_update_optimistic_lock_and_no_expired_release(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, days=2)
    batch = lots(db, tenant, row)[0]
    payload = catalog.InventoryBatchUpdateIn(status="quarantine", expected_version=batch.version, lot_code="CHECKED", reason="Quality check")
    catalog.update_inventory_batch(row.id, batch.id, payload, db=db, tenant=tenant, user=ADMIN)
    with pytest.raises(HTTPException) as exc:
        catalog.update_inventory_batch(row.id, batch.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException):
        catalog.update_inventory_batch(row.id, batch.id, payload.model_copy(update={"status": "available", "expected_version": batch.version, "expires_on": business_today()-timedelta(days=1)}), db=db, tenant=tenant, user=ADMIN)


def test_batch_allocations_have_enforced_foreign_keys():
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import Session
    from app.db import Base
    from app.models import Tenant
    engine = create_engine('sqlite://')
    @event.listens_for(engine, 'connect')
    def foreign_keys(connection, record):
        connection.execute('PRAGMA foreign_keys=ON')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(Tenant(id='fk-tenant', name='Synthetic', slug='fk-tenant', domain='fk.test', status='active')); db.commit()
        row = InventoryItem(tenant_id='fk-tenant', name='FK stock', unit='kg', stock_qty=D('5'), unit_cost=D('2'), min_limit=D('0'))
        db.add(row); db.commit()
        allocation = db.query(InventoryBatchMovement).filter_by(item_id=row.id).one()
        assert allocation.batch_id and allocation.movement_id
        assert allocation.batch.quantity_remaining == D('5')
        assert allocation.movement.quantity_after == D('5')
    engine.dispose()


def test_nrv_is_in_profit_and_loss_and_legacy_mode_maps_consistently(db, tenant):
    from app.routers import finance
    from app.gl import bridge, shadow
    row = item(db, tenant)
    receive(db, tenant, row, qty='10', price='20')
    bridge.set_ledger_mode(db, tenant.id, 'legacy', actor='tester', reason='legacy test'); db.commit()
    catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('10'), expected_unit_cost=D('2'), reason='Lower NRV', idempotency_key='pl-nrv-001'), db=db, tenant=tenant, user=ADMIN)
    report = finance._profit_loss_report(db, tenant.id, None, None)
    assert D(report['operating_expenses']) == D('10')
    assert D(report['net_profit']) == D('-10')
    catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('2'), expected_qty=D('10'), expected_unit_cost=D('1'), reason='Recovered NRV', idempotency_key='pl-nrv-002'), db=db, tenant=tenant, user=ADMIN)
    report = finance._profit_loss_report(db, tenant.id, None, None)
    assert D(report['operating_expenses']) == 0
    shadow.sync_tenant(db, tenant.id)
    ok(db, tenant.id)


def test_failed_native_valuation_rolls_back_stock_value_and_request(db, tenant, monkeypatch):
    from app.gl import bridge
    from app.models import FinanceOperationRequest
    row = item(db, tenant)
    receive(db, tenant, row, qty='10', price='20')
    monkeypatch.setattr(bridge, 'emit', lambda *args, **kwargs: None)
    payload = catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('10'), expected_unit_cost=D('2'), reason='NRV decreased', idempotency_key='failed-native-nrv-01')
    with pytest.raises(HTTPException) as exc:
        catalog.value_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409
    db.refresh(row)
    assert row.unit_cost == D('2')
    assert db.query(InventoryValuation).filter_by(item_id=row.id).count() == 0
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, transaction_type='inventory_nrv_write_down').count() == 0
    assert db.query(FinanceOperationRequest).filter_by(tenant_id=tenant.id, idempotency_key=payload.idempotency_key).count() == 0


def test_real_pos_sale_uses_fefo_and_impaired_carrying_cost(db, tenant):
    from datetime import datetime
    import json
    from app.models import MenuItem, Recipe, Shift, Setting, Sale
    from app.routers import pos, finance
    from app.schemas import SaleCreateIn, SaleItemIn
    row = item(db, tenant)
    receive(db, tenant, row, qty='5', price='10', days=20, code='LATE')
    receive(db, tenant, row, qty='5', price='10', days=2, code='EARLY')
    menu = MenuItem(tenant_id=tenant.id, item_name='Batch recipe drink', category='Drink', price=D('5'))
    db.add(menu); db.flush()
    db.add_all([Recipe(tenant_id=tenant.id, menu_item_name=menu.item_name, ingredient_name=row.name,
        menu_item_id=menu.id, inventory_item_id=row.id, quantity_required=D('1')),
        Shift(tenant_id=tenant.id, status='open', opened_by=ADMIN.username, opened_at=datetime.utcnow()),
        Setting(tenant_id=tenant.id, key=pos.STAFF_SHIFT_SESSIONS_KEY, value=json.dumps({ADMIN.username: {}}))]); db.commit()
    catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('10'), expected_unit_cost=D('2'), reason='NRV lower', idempotency_key='sale-nrv-01'), db=db, tenant=tenant, user=ADMIN)
    result = pos.create_sale(SaleCreateIn(cart_items=[SaleItemIn(item_name=menu.item_name, price=D('5'), qty=1)], payment_method='cash'), db=db, tenant=tenant, user=ADMIN)
    sale = db.get(Sale, result['sale_id'])
    assert sale.cogs == D('1')
    assert row.stock_qty == D('9')
    assert {b.lot_code: b.quantity_remaining for b in lots(db, tenant, row)} == {'EARLY': D('4'), 'LATE': D('5')}
    assert D(finance._profit_loss_report(db, tenant.id, None, None)['net_profit']) == D('-6')
    assert catalog.reconcile_inventory(db=db, tenant=tenant, user=ADMIN)['balanced']
    ok(db, tenant.id)


def test_lifecycle_backup_contains_lots_valuations_and_iso_dates(db, tenant):
    import json
    from app.routers import operations
    row = item(db, tenant)
    receive(db, tenant, row, qty='5', price='10', days=4, code='BACKUP-LOT')
    catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('5'), expected_unit_cost=D('2'), reason='Backup valuation', idempotency_key='backup-nrv-001'), db=db, tenant=tenant, user=ADMIN)
    backup = operations.export_database_backup(db=db, tenant=tenant, user=ADMIN)
    encoded = json.dumps(backup)
    assert 'BACKUP-LOT' in encoded
    assert backup['_inventory_lifecycle_version'] == 1
    assert len(backup['inventory_batches']) == 1
    assert len(backup['inventory_batch_movements']) == 1
    assert len(backup['inventory_valuations']) == 1
    assert backup['inventory'][0]['cost_basis_unit_cost'] == '2.0000'
    assert isinstance(backup['inventory_batches'][0]['expires_on'], str)


def test_lifecycle_cross_tenant_and_stale_valuation_are_rejected(db, tenant):
    from app.models import Tenant
    row = item(db, tenant)
    receive(db, tenant, row)
    batch = lots(db, tenant, row)[0]
    other = Tenant(id='lifecycle-other', name='Other', slug='lifecycle-other', domain='lifecycle-other.test', status='active')
    db.add(other); db.commit()
    with pytest.raises(HTTPException) as exc:
        catalog.update_inventory_batch(row.id, batch.id, catalog.InventoryBatchUpdateIn(status='quarantine', expected_version=batch.version, reason='Wrong tenant'), db=db, tenant=other, user=ADMIN)
    assert exc.value.status_code == 404
    payload = catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('99'), expected_unit_cost=D('2'), reason='Stale count', idempotency_key='stale-nrv-001')
    with pytest.raises(HTTPException) as exc:
        catalog.value_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409
    assert db.get(InventoryItem, row.id).unit_cost == D('2')


def test_count_surplus_does_not_create_an_unrecognised_write_down_reversal(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, qty='10', price='20')
    catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('10'), expected_unit_cost=D('2'), reason='NRV lower', idempotency_key='count-cap-nrv-001'), db=db, tenant=tenant, user=ADMIN)
    catalog.count_inventory(row.id, catalog.InventoryCountIn(counted_qty=D('15'), expected_qty=D('10'), reason='Found stock', idempotency_key='count-cap-count-001'), db=db, tenant=tenant, user=ADMIN)
    result = catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('10'), expected_qty=D('15'), expected_unit_cost=D('1'), reason='Recovered NRV', idempotency_key='count-cap-nrv-002'), db=db, tenant=tenant, user=ADMIN)
    assert D(result['amount']) == D('10')
    assert row.cost_basis_unit_cost == D('1.6667')


def test_expired_lot_blocks_real_pos_sale_and_rolls_back_money(db, tenant, monkeypatch):
    from datetime import datetime
    import json
    from app.models import MenuItem, Recipe, Shift, Setting, Sale
    from app.routers import pos
    from app.schemas import SaleCreateIn, SaleItemIn
    row = item(db, tenant)
    receive(db, tenant, row, qty='5', price='10', days=1)
    menu = MenuItem(tenant_id=tenant.id, item_name='Expired recipe drink', category='Drink', price=D('5'))
    db.add(menu); db.flush()
    db.add_all([Recipe(tenant_id=tenant.id, menu_item_name=menu.item_name, ingredient_name=row.name, menu_item_id=menu.id, inventory_item_id=row.id, quantity_required=D('1')),
        Shift(tenant_id=tenant.id, status='open', opened_by=ADMIN.username, opened_at=datetime.utcnow()),
        Setting(tenant_id=tenant.id, key=pos.STAFF_SHIFT_SESSIONS_KEY, value=json.dumps({ADMIN.username: {}}))]); db.commit()
    before = db.query(FinanceTransaction).filter_by(tenant_id=tenant.id).count()
    tomorrow = business_today()+timedelta(days=2)
    monkeypatch.setattr('app.services.inventory_batches.business_today', lambda: tomorrow)
    with pytest.raises(HTTPException) as exc:
        pos.create_sale(SaleCreateIn(cart_items=[SaleItemIn(item_name=menu.item_name, price=D('5'), qty=1)], payment_method='cash'), db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409
    db.rollback(); db.refresh(row)
    assert row.stock_qty == D('5')
    assert db.query(Sale).filter_by(tenant_id=tenant.id).count() == 0
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id).count() == before


def test_closed_period_rejects_nrv_without_a_partial_legacy_posting(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, qty='5', price='10')
    day = business_today()
    period = gl.get_or_create_period(db, tenant.id, day)
    period.status = 'closed'; db.commit()
    with pytest.raises(HTTPException) as exc:
        catalog.value_inventory(row.id, catalog.InventoryValuationIn(nrv_unit_cost=D('1'), expected_qty=D('5'), expected_unit_cost=D('2'), reason='Closed-period test', idempotency_key='closed-period-nrv'), db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409
    db.refresh(row)
    assert row.unit_cost == D('2')
    assert db.query(InventoryValuation).filter_by(item_id=row.id).count() == 0
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, transaction_type='inventory_nrv_write_down').count() == 0


def test_cogs_consumption_uses_same_precision_as_fefo_quantity():
    from app.services.inventory_batches import stock_consumption_qty
    assert stock_consumption_qty(D('0.0006')) == D('0.001')
    assert stock_consumption_qty(D('0.1234')) == D('0.123')
    with pytest.raises(HTTPException):
        stock_consumption_qty(D('0.0004'))


def test_quarantine_only_update_preserves_existing_lot_metadata(db, tenant):
    row = item(db, tenant)
    receive(db, tenant, row, days=10, code='KEEP-LOT')
    batch = lots(db, tenant, row)[0]
    old_expiry = batch.expires_on
    catalog.update_inventory_batch(row.id, batch.id, catalog.InventoryBatchUpdateIn(status='quarantine', expected_version=batch.version, reason='Quality hold'), db=db, tenant=tenant, user=ADMIN)
    assert batch.lot_code == 'KEEP-LOT'
    assert batch.expires_on == old_expiry


def test_new_dated_product_and_duplicate_add_keep_expiry_requirement(db, tenant):
    expiry = business_today()+timedelta(days=7)
    payload = InventoryItemCreateIn(name='Dated new product', stock_qty=D('2'), unit='litr', unit_cost=D('3'), expiry_required=True,
        lot_code='INITIAL-LOT', expires_on=expiry, payment_source='cash', idempotency_key='new-dated-product-01')
    response = catalog.create_inventory_item(payload, db=db, tenant=tenant, user=ADMIN)
    row = db.get(InventoryItem, response['id'])
    assert row.expiry_required and row.cost_basis_unit_cost == D('3')
    batch = lots(db, tenant, row)[0]
    assert batch.expires_on == expiry and batch.lot_code == 'INITIAL-LOT'
    with pytest.raises(HTTPException):
        catalog.create_inventory_item(payload.model_copy(update={'expiry_required': False, 'expires_on': None, 'idempotency_key': 'new-dated-product-02'}), db=db, tenant=tenant, user=ADMIN)
    db.refresh(row)
    assert row.expiry_required and row.stock_qty == D('2')


def test_legacy_undated_stock_preserves_old_negative_policy_without_changing_history(db, tenant):
    row = item(db, tenant, qty='2', cost='0')
    row.legacy_negative_allowed = True; db.commit()
    consume(db, tenant, row, '3')
    assert row.stock_qty == D('-1')
    assert sum((b.quantity_remaining for b in lots(db, tenant, row)), D('0')) == D('-1')
    receive(db, tenant, row, qty='2', price='0', days=None, code='DEFICIT-RECEIPT')
    received = next(b for b in lots(db, tenant, row) if b.lot_code == 'DEFICIT-RECEIPT')
    assert received.quantity_received == D('2')
    assert received.quantity_remaining == D('1')
    assert row.stock_qty == D('1')


def test_legacy_flag_never_bypasses_dated_or_quarantined_lots(db, tenant):
    row = item(db, tenant)
    row.legacy_negative_allowed = True; db.commit()
    receive(db, tenant, row, qty='1', price='0', days=2, code='CONTROLLED')
    consume(db, tenant, row, '1')
    with pytest.raises(HTTPException) as exc:
        consume(db, tenant, row, '1')
    assert exc.value.status_code == 409
    db.rollback(); db.refresh(row)
    assert row.stock_qty == D('0')


def test_dated_receipt_fully_closing_legacy_deficit_retains_receipt_metadata(db, tenant):
    row = item(db, tenant, qty='-2', cost='0')
    row.legacy_negative_allowed = True; db.commit()
    receive(db, tenant, row, qty='2', price='0', days=2, code='CLOSED-DEFICIT')
    receipt = next(b for b in lots(db, tenant, row) if b.lot_code == 'CLOSED-DEFICIT')
    assert receipt.quantity_received == D('2') and receipt.quantity_remaining == 0
    assert receipt.expires_on is not None
    with pytest.raises(HTTPException):
        consume(db, tenant, row, '1')
    db.rollback()
