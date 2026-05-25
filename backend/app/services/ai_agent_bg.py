import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session
from app.db import SessionLocal
from app.models import Tenant, InventoryItem, Sale, AgentInsight
from app.services.opencode_service import generate_text

logger = logging.getLogger(__name__)

# This agent loop will run periodically
AGENT_INTERVAL_SECONDS = 3600  # every 1 hour

async def _agent_loop():
    logger.info("AI Background Agent started.")
    while True:
        try:
            await asyncio.sleep(AGENT_INTERVAL_SECONDS)
            _run_agent_tasks()
        except asyncio.CancelledError:
            logger.info("AI Background Agent stopped.")
            break
        except Exception as e:
            logger.error(f"Error in AI Background Agent loop: {e}")

def _run_agent_tasks():
    with SessionLocal() as db:
        tenants = db.query(Tenant).filter(Tenant.status == "active").all()
        for tenant in tenants:
            try:
                _analyze_inventory_and_sales(db, tenant.id)
            except Exception as e:
                logger.error(f"Agent error for tenant {tenant.id}: {e}")

def _analyze_inventory_and_sales(db: Session, tenant_id: str):
    # Check low stock
    low_stock_items = db.query(InventoryItem).filter(
        InventoryItem.tenant_id == tenant_id,
        InventoryItem.stock_qty <= InventoryItem.min_limit
    ).all()

    # Get today's sales
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sales = db.query(Sale).filter(
        Sale.tenant_id == tenant_id,
        Sale.created_at >= today,
        Sale.status == "COMPLETED"
    ).all()

    total_revenue = sum(s.total for s in sales)

    if not low_stock_items and total_revenue == 0:
        return # Nothing to analyze

    prompt_parts = [
        "Sən iRonWaves POS sisteminin arxa planda çalışan avtonom menecer agentisən.",
        "Aşağıdakı məlumatları analiz edərək obyekt rəhbərinə qısa, konkret biznes və əməliyyat məsləhətləri ver."
    ]

    if low_stock_items:
        items_str = ", ".join([f"{item.name} ({item.stock_qty} {item.unit} qalıb)" for item in low_stock_items])
        prompt_parts.append(f"Anbarda bitmək üzrə olan məhsullar: {items_str}")
    
    if total_revenue > 0:
        prompt_parts.append(f"Gün ərzində {len(sales)} ədəd satışdan ümumi {total_revenue} gəlir əldə edilib.")

    prompt = "\n".join(prompt_parts)

    try:
        # Call OpenCode.ai free models
        response_text = generate_text(
            model=None,  # will use default free model with fallback if configured
            prompt=prompt,
            system="Sən biznes və maliyyə məsləhətçisisən. Qısa, dəqiq və təcili görülməli olan işləri vurğula.",
            temperature=0.3,
            max_tokens=600,
        )

        insight = AgentInsight(
            tenant_id=tenant_id,
            insight_type="Gündəlik Təhlil",
            content=response_text,
            is_read=False
        )
        db.add(insight)
        db.commit()
        logger.info(f"Agent generated insight for tenant {tenant_id}")
    except Exception as e:
        logger.error(f"Failed to generate insight via OpenCode: {e}")

def generate_ai_recipe(item_name: str) -> str:
    """Generates an international standard recipe for a given menu item name."""
    prompt = f"Mənə '{item_name}' adlı yemək/içki üçün beynəlxalq restoran standartlarına uyğun peşəkar resept hazırla. Tərkibləri dəqiq qramajla (və ya ml) və hazırlanma qaydasını addım-addım yaz."
    try:
        response_text = generate_text(
            model=None,
            prompt=prompt,
            system="Sən dünyanın ən yaxşı baş aşpazlarından birisən. Reseptlərin dəqiq, beynəlxalq standartlara uyğun və iqtisadi cəhətdən əsaslıdır.",
            temperature=0.4,
            max_tokens=800,
        )
        return response_text
    except Exception as e:
        logger.error(f"Failed to generate recipe via OpenCode: {e}")
        return f"AI ilə resept hazırlamaq mümkün olmadı: {e}"

def start_background_agent():
    loop = asyncio.get_event_loop()
    task = loop.create_task(_agent_loop())
    return task
