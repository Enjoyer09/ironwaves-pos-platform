from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AgentInsight, MenuItem, Tenant, User
from app.services.ai_agent_bg import generate_ai_recipe
from app.services.ai_chat import ask_help_assistant
from app.core.config import settings as app_settings

import json
import logging
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

logger = logging.getLogger("ironwaves.agent")

router = APIRouter(prefix="/api/v1/ops/agent", tags=["ai-agent"])

def _ensure_manager(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail="Manager access required")

class RecipeGenerateIn(BaseModel):
    item_name: str

@router.get("/insights")
def get_insights(
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _ensure_manager(user)
    insights = db.query(AgentInsight).filter(
        AgentInsight.tenant_id == tenant.id
    ).order_by(AgentInsight.created_at.desc()).limit(10).all()

    return {
        "success": True,
        "insights": [
            {
                "id": i.id,
                "type": i.insight_type,
                "content": i.content,
                "is_read": i.is_read,
                "created_at": i.created_at.isoformat()
            }
            for i in insights
        ]
    }

@router.post("/insights/{insight_id}/read")
def mark_insight_read(
    insight_id: str,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    _ensure_manager(user)
    insight = db.query(AgentInsight).filter(
        AgentInsight.id == insight_id,
        AgentInsight.tenant_id == tenant.id
    ).first()
    
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
        
    insight.is_read = True
    db.commit()
    return {"success": True}

@router.post("/recipe/generate")
def generate_recipe(
    payload: RecipeGenerateIn,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user)
):
    _ensure_manager(user)
    if not payload.item_name.strip():
        raise HTTPException(status_code=400, detail="Item name is required")
        
    recipe_text = generate_ai_recipe(payload.item_name)
    return {
        "success": True,
        "recipe": recipe_text
    }

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    lang: str = "az"

@router.post("/chat")
def chat_with_assistant(
    payload: ChatRequest,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user)
):
    # Ensure they are logged in. Any role can access the help assistant.
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    messages_dict = [{"role": msg.role, "content": msg.content} for msg in payload.messages]
    
    reply = ask_help_assistant(messages_dict, payload.lang)
    return {
        "success": True,
        "reply": reply
    }


# ─── Stock Photo Auto-Image for Menu Items ────────────────────────────────────

def _search_pexels(query: str, per_page: int = 1) -> str | None:
    """Search Pexels for a food photo and return the medium-sized URL."""
    api_key = app_settings.pexels_api_key
    if not api_key:
        return None
    try:
        url = f"https://api.pexels.com/v1/search?query={urllib_request.quote(query)}&per_page={per_page}&orientation=landscape"
        req = urllib_request.Request(url, headers={"Authorization": api_key})
        with urllib_request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            photos = data.get("photos", [])
            if photos:
                return str(photos[0].get("src", {}).get("medium", ""))
    except (HTTPError, URLError, Exception) as e:
        logger.warning(f"Pexels search failed for '{query}': {e}")
    return None


def _build_food_search_query(item_name: str, category: str) -> str:
    """Build an optimized search query for food stock photos."""
    # Remove common non-descriptive words
    noise = {"tək", "tek", "menu", "menyu", "menyular", "ədəd", "əd", "pors", "combo", "kampanyali", "xüsusi"}
    words = [w for w in item_name.lower().split() if w not in noise and len(w) > 1]
    # Limit to first 3 meaningful words + "food" for better results
    query_words = words[:3]
    if category.lower() not in " ".join(query_words):
        query_words.append(category.lower())
    query_words.append("food")
    return " ".join(query_words)


class AutoImageRequest(BaseModel):
    category: str | None = None
    item_ids: list[str] | None = None
    overwrite: bool = False


class AutoImageResult(BaseModel):
    item_id: str
    item_name: str
    image_url: str | None
    status: str  # "assigned", "skipped", "failed"


@router.post("/menu/auto-image")
def auto_assign_menu_images(
    payload: AutoImageRequest,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Automatically assign stock photos to menu items based on their names.
    - category: filter by category (e.g. "DESERT")
    - item_ids: specific item IDs to process (overrides category filter)
    - overwrite: if True, replace existing images; if False, only fill empty ones
    """
    _ensure_manager(user)

    if not app_settings.pexels_api_key:
        raise HTTPException(status_code=400, detail="Pexels API key is not configured. Add PEXELS_API_KEY to .env")

    # Get target items
    query = db.query(MenuItem).filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)

    if payload.item_ids:
        query = query.filter(MenuItem.id.in_(payload.item_ids))
    elif payload.category:
        from sqlalchemy import func
        query = query.filter(func.lower(MenuItem.category) == payload.category.lower())

    items = query.order_by(MenuItem.sort_order.asc()).all()

    if not items:
        raise HTTPException(status_code=404, detail="No menu items found matching the criteria")

    results: list[dict] = []
    assigned_count = 0

    for item in items:
        # Skip items that already have images (unless overwrite=True)
        if item.image_url and not payload.overwrite:
            results.append({
                "item_id": item.id,
                "item_name": item.item_name,
                "image_url": item.image_url,
                "status": "skipped",
            })
            continue

        # Search for a stock photo
        search_query = _build_food_search_query(item.item_name, item.category or "")
        image_url = _search_pexels(search_query)

        if not image_url:
            # Try simpler query with just the item name
            image_url = _search_pexels(f"{item.item_name} food")

        if image_url:
            item.image_url = image_url
            assigned_count += 1
            results.append({
                "item_id": item.id,
                "item_name": item.item_name,
                "image_url": image_url,
                "status": "assigned",
            })
        else:
            results.append({
                "item_id": item.id,
                "item_name": item.item_name,
                "image_url": None,
                "status": "failed",
            })

    if assigned_count > 0:
        db.commit()

    return {
        "success": True,
        "total": len(items),
        "assigned": assigned_count,
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "results": results,
    }


@router.get("/menu/search-image")
def search_stock_image(
    query: str,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    """Search for a stock photo by query. Returns up to 5 results for manual selection."""
    _ensure_manager(user)

    if not app_settings.pexels_api_key:
        raise HTTPException(status_code=400, detail="Pexels API key is not configured")

    api_key = app_settings.pexels_api_key
    try:
        url = f"https://api.pexels.com/v1/search?query={urllib_request.quote(query + ' food')}&per_page=5&orientation=landscape"
        req = urllib_request.Request(url, headers={"Authorization": api_key})
        with urllib_request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            photos = data.get("photos", [])
            return {
                "success": True,
                "results": [
                    {
                        "id": str(photo.get("id", "")),
                        "url_medium": photo.get("src", {}).get("medium", ""),
                        "url_large": photo.get("src", {}).get("large", ""),
                        "url_small": photo.get("src", {}).get("small", ""),
                        "photographer": photo.get("photographer", ""),
                        "alt": photo.get("alt", ""),
                    }
                    for photo in photos
                ],
            }
    except (HTTPError, URLError, Exception) as e:
        raise HTTPException(status_code=502, detail=f"Pexels API error: {str(e)}")
