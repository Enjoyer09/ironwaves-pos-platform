"""P4.4 — `/push/funnel` endpointi (ölçmə və atribusiya).

Niyə test lazımdır: bu endpoint rəqəm göstərir və admin ona **qərar verir**.
Səssizcə yanlış hesablasa "kampaniya işləyir" təəssüratı yaranar və büdcə ona
görə xərclənər. Kilidlənən qaydalar:

  1. **Açılma siqnalı yoxdur və bu gizlədilmir.** Cavab `attribution="redemption"`
     və `open_tracking=False` yazır; `conversion_rate` sahəsi **yoxdur**.
  2. **Ləğv edilmiş çeklər sayılmır** — qaytarılmış satış "kampaniya işlədi"
     deyil.
  3. **Saylar serverdə aqreqatlanır** (`GROUP BY`), panelin 50 sətirlik tarixçə
     siyahısından yox — yoxsa "3 bildiriş" yazıb əslində 12 göndərmiş olardıq.
  4. **Birləşmə iki tərəflidir**: göndərilib istifadə olunmayan kampaniya da,
     istifadə olunub göndərilməyən kampaniya da görünür.
"""

import importlib
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeQuery:
    """`filter` zəncirini udan, sonda hazır sətirləri qaytaran stub."""

    def __init__(self, items):
        self.items = items
        self.filters = []

    def filter(self, *args, **kwargs):
        self.filters.append(args)
        return self

    def group_by(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def all(self):
        return self.items

    def first(self):
        return self.items[0] if self.items else None


class _FakeDB:
    """Dörd sorğunu (`PushDelivery`, `Sale`, `HappyHour`, `PushEngagement`) model adı ilə cavablandırır.

    SQL ifadələrini **icra etmir**: bu test endpointin *məntiqini* yoxlayır
    (birləşmə, attribusiya sözü, sıralama), SQL-in özünü yox. Aqreqatın SQL-də
    doğru olduğunu `GROUP BY` sorğunun forması + real DB testi göstərir.

    `deliveries` iki formada ola bilər:
      - cütlük tuple-ı `("c1", sends, recipients, accepted, failed)` — QROUP BY
        aqreqatı (köhnə forma);
      - `.id`/`.campaign_id` atributlu obyekt — P4.5-in id→kampaniya keçid
        sorğusu (yeni forma). Forma avtomatik tanınır.
    """

    def __init__(self, deliveries=(), sales=(), campaigns=(), engagements=(), delivery_links=()):
        self.deliveries = list(deliveries)
        self.sales = list(sales)
        self.campaigns = list(campaigns)
        self.engagements = list(engagements)
        # P4.5 — id→kampaniya keçid sorğusu `.id`/`.campaign_id` atributlu
        # obyektlər qaytarır (aqreqat sorğusu isə tuple-λar). Ayrı saxlanılır.
        self.delivery_links = list(delivery_links)
        self.queries = []

    def query(self, *columns):
        # `db.query(PushDelivery.campaign_id, func.count(...))` — ilk arqument
        # sinif DEYİL, sütundur. Sütunun sahibi `class_`-dır; `__name__` isə
        # sütunun öz adıdır ("campaign_id") və `Sale` ilə `PushDelivery`-i
        # ayıra bilməz.
        first = columns[0] if columns else None
        owner = getattr(first, "class_", None)
        name = getattr(owner, "__name__", "") or getattr(first, "__name__", "")
        # Eyni `PushDelivery` iki fərqli xəttdir: aqreqat `campaign_id` ilə
        # başlayır, P4.5 keçidi `id` ilə. `.key` ilə ayırırıq.
        first_key = str(getattr(first, "key", "") or "")
        q = _FakeQuery([])
        if name == "PushDelivery":
            q = _FakeQuery(self.delivery_links if first_key == "id" else self.deliveries)
        elif name == "Sale":
            q = _FakeQuery(self.sales)
        elif name == "HappyHour":
            q = _FakeQuery(self.campaigns)
        elif name == "PushEngagement":
            q = _FakeQuery(self.engagements)
        self.queries.append((name, first_key, columns))
        return q

    def add(self, row):
        pass

    def commit(self):
        pass


ADMIN = SimpleNamespace(username="admin", role="admin")
MANAGER = SimpleNamespace(username="mgr", role="manager")
STAFF = SimpleNamespace(username="cashier", role="staff")
TENANT = SimpleNamespace(id="tenant-1")


def _ops():
    _bootstrap_env()
    return importlib.import_module("app.routers.operations")


def _funnel(db, **kwargs):
    ops = _ops()
    params = {"days": 90, "campaign_id": None, "db": db, "tenant": TENANT, "user": ADMIN}
    params.update(kwargs)
    return ops.get_push_funnel(**params)


# ---------------------------------------------------------------------------
# Dürüstlük: huninin son pilləsi atribusiya deyil
# ---------------------------------------------------------------------------


def test_response_never_claims_open_or_conversion():
    """Endpoint açılma izləməsini iddia etməməlidir.

    P4.5-dən sonra `opened` sahəsi **var** (hadisə olduqda 0-dan çox), amma
    `open_tracking` olmadan "0 açılma" DEYİL, "izlənmir" deməkdir — panel bunu
    belə göstərir. `conversion_rate` adı sübutsuz iddia olduğu üçün ÜMUMİYYƏTLƏ
    olmamalıdır.
    """
    db = _FakeDB(
        deliveries=[("c1", 2, 400, 386, 14)],
        sales=[("c1", 37, 31, 812.5, 96.25)],
        delivery_links=[SimpleNamespace(id="d-1", campaign_id="c1")],
        engagements=[("d-1", 3, 2)],  # 3 toxunma, 2 təkrarsız abunə
    )
    body = _funnel(db)
    summary = body["summary"]

    # P4.5: hadisə QEYD OLUNUB (engagements var) → açılma izləməsi aktivdir.
    assert summary["open_tracking"] is True
    assert summary["attribution"] == "redemption"
    assert summary["opened"] == 3
    row = body["funnels"][0]
    assert row["open_tracking"] is True
    assert row["opened"] == 3
    assert row["openers"] == 2
    assert row["open_rate"] == 0.75  # 3 / 400
    assert row["attribution"] == "redemption"
    # `conversion_rate` adı sübutsuz iddia olardı — sahə ÜMUMİYYƏTLƏ olmamalıdır.
    assert "conversion_rate" not in row
    assert "clicked" not in row


def test_no_engagement_rows_means_open_tracking_off():
    """Hadisə sətri YOXDURsa `open_tracking` `False` qalmalıdır.

    Əsas dürüstlük qaydası: hadisə yoxdursa panel "0 açılma" göstərməməlidir —
    bu, "heç kəs açmadı" yalanı olardı. "İzlənilmir" göstərməlidir.
    """
    db = _FakeDB(
        deliveries=[("c1", 1, 100, 100, 0)],
        sales=[],
        delivery_links=[SimpleNamespace(id="d-1", campaign_id="c1")],
    )
    body = _funnel(db)
    assert body["summary"]["open_tracking"] is False
    assert body["summary"]["opened"] == 0
    row = body["funnels"][0]
    assert row["open_tracking"] is False
    assert row["openers"] == 0


def test_funnel_merges_delivery_and_usage_counts():
    db = _FakeDB(deliveries=[("c1", 2, 400, 386, 14)], sales=[("c1", 37, 31, 812.5, 96.25)])
    row = _funnel(db)["funnels"][0]

    assert row["campaign_id"] == "c1"
    assert row["sends"] == 2
    assert row["recipients"] == 400
    assert row["accepted"] == 386
    assert row["failed"] == 14
    assert row["orders"] == 37
    assert row["customers"] == 31
    assert row["revenue"] == 812.5
    assert row["delivery_rate"] == 96.5
    assert row["redemption_rate"] == 9.25


def test_campaign_that_was_sent_but_not_used_still_appears():
    """Göndərilib istifadə olunmayan kampaniya siyahıdan düşməməlidir.

    Əks halda "işləməyən kampaniyalar görünmür" effekti yaranar və panel
    həmişə uğurlu görünər.
    """
    db = _FakeDB(
        deliveries=[("c1", 1, 100, 100, 0)],
        sales=[],
        delivery_links=[SimpleNamespace(id="d-1", campaign_id="c1")],
    )
    body = _funnel(db)

    assert len(body["funnels"]) == 1
    row = body["funnels"][0]
    assert row["orders"] == 0
    assert row["attribution"] == "no_redemption"
    assert row["redemption_rate"] == 0.0
    assert body["summary"]["campaigns_with_orders"] == 0


def test_used_but_never_sent_campaign_also_appears():
    """Tərs hal: köhnə/əl ilə endirim tətbiq olunub, push göndərilməyib.

    Belə sətir göndərmə olmadan **redemption_rate 0** verir — bu, düzgündür
    (bölən yoxdur) və panel "bilmirik" kimi göstərir.
    """
    db = _FakeDB(deliveries=[], sales=[("c9", 4, 4, 88.0, 8.0)])
    body = _funnel(db)

    assert len(body["funnels"]) == 1
    row = body["funnels"][0]
    assert row["orders"] == 4
    assert row["recipients"] == 0
    assert row["redemption_rate"] == 0.0
    assert row["attribution"] == "redemption"


def test_funnels_sorted_by_orders_desc():
    db = _FakeDB(
        deliveries=[("low", 1, 10, 10, 0), ("high", 1, 900, 900, 0)],
        sales=[("low", 2, 2, 20.0, 2.0), ("high", 90, 80, 900.0, 90.0)],
    )
    ids = [row["campaign_id"] for row in _funnel(db)["funnels"]]
    assert ids == ["high", "low"]


def test_campaign_names_are_attached():
    db = _FakeDB(
        deliveries=[("c1", 1, 10, 10, 0)],
        sales=[("c1", 1, 1, 5.0, 0.5)],
        campaigns=[SimpleNamespace(id="c1", name="Cümə endirimi")],
    )
    assert _funnel(db)["funnels"][0]["campaign_name"] == "Cümə endirimi"


def test_revenue_is_post_discount_total_not_gross():
    """`Sale.total` endirimdən SONRAKI məbləğdir — ayrıca çıxma yoxdur.

    Əgər burada endirim yenidən çıxılsaydı, gəlir iki dəfə azalardı.
    """
    db = _FakeDB(
        deliveries=[("c1", 1, 100, 100, 0)],
        sales=[("c1", 2, 2, 20.0, 5.0)],
    )
    row = _funnel(db)["funnels"][0]
    assert row["revenue"] == 20.0
    assert row["discount"] == 5.0
    assert row["avg_order_value"] == 10.0


# ---------------------------------------------------------------------------
# Rol qapısı və parametrlər
# ---------------------------------------------------------------------------


def test_manager_can_read_the_funnel():
    db = _FakeDB(deliveries=[("c1", 1, 10, 10, 0)])
    assert _funnel(db, user=MANAGER)["days"] == 90


def test_staff_is_refused():
    db = _FakeDB()
    with pytest.raises(HTTPException) as exc:
        _funnel(db, user=STAFF)
    assert exc.value.status_code == 403


def test_days_is_echoed_and_since_is_computed():
    db = _FakeDB()
    body = _funnel(db, days=7)
    assert body["days"] == 7
    assert body["since"]


def test_empty_tenant_returns_zeroed_summary():
    body = _funnel(_FakeDB())
    assert body["funnels"] == []
    assert body["summary"]["campaigns"] == 0
    assert body["summary"]["redemption_rate"] == 0.0
    assert body["summary"]["delivery_rate"] == 0.0
    assert body["summary"]["attribution"] == "no_redemption"


def test_summary_rate_is_recomputed_not_averaged():
    """5 nəfərlik plan 900 nəfərlik planı "düzəltməməlidir".

    Ortalamaların ortası 10.5% verərdi; doğru cavab cəmdən yenidən hesablanır
    (100 istifadə / 1000 göndərmə = 10%).
    """
    db = _FakeDB(
        deliveries=[("small", 1, 100, 100, 0), ("big", 1, 900, 900, 0)],
        sales=[("small", 10, 10, 100.0, 10.0), ("big", 90, 90, 900.0, 90.0)],
    )
    summary = _funnel(db)["summary"]
    assert summary["redemption_rate"] == 10.0
    # Təkrarsız müştəri sayı cəmdən çıxmır — `None`, uydurma 0 deyil.
    assert summary["customers"] is None


def test_stub_actually_served_the_queries():
    """Stub boş qaytarsa yuxarıdaki testlər **boş-boşuna** keçərdi.

    Bu qoruyucu üç sorğunun həqiqətən göndərildiyini yoxlayır: `PushDelivery`
    (göndərmə), `Sale` (istifadə) və `HappyHour` (ad). Yoxsa "huni düzdür"
    nəticəsi sadəcə stub-un susması olardı.
    """
    db = _FakeDB(
        deliveries=[("c1", 1, 10, 10, 0)],
        sales=[("c1", 1, 1, 5.0, 0.5)],
        campaigns=[SimpleNamespace(id="c1", name="Ad")],
    )
    _funnel(db)
    models = [name for name, _, __ in db.queries]
    assert "PushDelivery" in models
    assert "Sale" in models
    assert "HappyHour" in models


# ---------------------------------------------------------------------------
# Real SQL — stub-un görmədiyi yerlər
# ---------------------------------------------------------------------------
#
# Yuxarıdaki testlər endpointin MƏNTİQİNİ yoxlayır. SQL-in özü (GROUP BY,
# `count(distinct)`, `upper(status) notin (...)`) isə yalnız real bazada sınanır.
# Stub `filter`-i udur, yəni yazı xətası olan sorğu da "keçərdi".


def _real_db():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.models import Base

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed(db, *, campaign_id="c1", campaign_name="Cümə endirimi"):
    import json
    from datetime import datetime, timedelta

    from app.models import HappyHour, PushDelivery, Sale, Tenant

    db.add(Tenant(id="tenant-1", name="iRonWaves", slug="ironwaves", domain="ironwaves.local"))
    db.add(
        HappyHour(
            id=campaign_id,
            tenant_id="tenant-1",
            name=campaign_name,
            start_time="10:00",
            end_time="22:00",
            discount_percent=20,
            days_of_week_json=json.dumps([1, 2, 3, 4, 5]),
            categories="ALL",
            is_active=True,
        )
    )
    db.add(
        PushDelivery(
            tenant_id="tenant-1",
            kind="broadcast",
            campaign_id=campaign_id,
            status="sent",
            recipients=400,
            accepted=386,
            failed=14,
            created_at=datetime.utcnow() - timedelta(hours=3),
        )
    )
    for index, (total, discount, status, card) in enumerate(
        [
            (20.0, 5.0, "COMPLETED", "QR-1"),
            (40.0, 10.0, "COMPLETED", "QR-1"),  # eyni müştəri → təkrarsız say 1
            (99.0, 9.0, "VOIDED", "QR-2"),      # ləğv → sayılmamalıdır
        ]
    ):
        db.add(
            Sale(
                tenant_id="tenant-1",
                cashier="admin",
                customer_card_id=card,
                payment_method="cash",
                total=total,
                discount_amount=discount,
                campaign_id=campaign_id,
                items_json="[]",
                status=status,
                created_at=datetime.utcnow() - timedelta(hours=1, minutes=index),
            )
        )
    db.commit()
    return db


def test_real_sql_aggregates_and_skips_voided_sales():
    """Əsl SQL: ləğv edilmiş çek çıxılır, eyni müştəri bir dəfə sayılır."""
    db = _real_db()
    _seed(db)
    row = _funnel(db)["funnels"][0]

    assert row["recipients"] == 400
    assert row["accepted"] == 386
    # 3 satırdan biri VOIDED → 2 çek, 60 AZN, 15 AZN endirim.
    assert row["orders"] == 2
    assert row["customers"] == 1
    assert row["revenue"] == 60.0
    assert row["discount"] == 15.0
    assert row["avg_order_value"] == 30.0
    assert row["campaign_name"] == "Cümə endirimi"
    assert row["redemption_rate"] == 0.5  # 2 / 400


def test_real_sql_excludes_sales_outside_the_window():
    """Pəncərədən kənar satış huniyə düşməməlidir."""
    from datetime import datetime, timedelta

    from app.models import Sale

    db = _real_db()
    _seed(db)
    db.add(
        Sale(
            tenant_id="tenant-1",
            cashier="admin",
            customer_card_id="QR-9",
            payment_method="cash",
            total=500.0,
            discount_amount=50.0,
            campaign_id="c1",
            items_json="[]",
            status="COMPLETED",
            created_at=datetime.utcnow() - timedelta(days=200),
        )
    )
    db.commit()

    assert _funnel(db, days=90)["funnels"][0]["orders"] == 2
    # Pəncərə açılanda köhnə çek də sayılır.
    assert _funnel(db, days=365)["funnels"][0]["orders"] == 3


def test_real_sql_campaign_filter_narrows_both_sides():
    """`campaign_id` həm göndərməni, həm istifadəni süzməlidir."""
    db = _real_db()
    _seed(db)
    assert _funnel(db, campaign_id="c1")["funnels"][0]["orders"] == 2
    assert _funnel(db, campaign_id="yoxdur")["funnels"] == []
