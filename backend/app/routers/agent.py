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
        # Force food/drink context by searching in specific Pexels collections
        refined_query = f"{query} restaurant menu item close up"
        url = f"https://api.pexels.com/v1/search?query={urllib_request.quote(refined_query)}&per_page={per_page}&orientation=landscape&size=medium"
        req = urllib_request.Request(url, headers={
            "Authorization": api_key,
            "User-Agent": "iRonWaves-POS/1.0",
        })
        with urllib_request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            photos = data.get("photos", [])
            logger.info(f"Pexels response for '{refined_query}': {len(photos)} photos found, total_results={data.get('total_results', 0)}")
            if photos:
                medium_url = str(photos[0].get("src", {}).get("medium", ""))
                if medium_url:
                    return medium_url
    except HTTPError as e:
        logger.error(f"Pexels HTTP error for '{query}': {e.code} {e.reason}")
    except URLError as e:
        logger.error(f"Pexels URL error for '{query}': {e.reason}")
    except Exception as e:
        logger.error(f"Pexels unexpected error for '{query}': {type(e).__name__}: {e}")
    return None


def _build_food_search_query(item_name: str, category: str) -> str:
    """Build an optimized search query for food stock photos."""
    # Remove common non-descriptive Azerbaijani words
    noise = {"tək", "tek", "menu", "menyu", "menyular", "ədəd", "əd", "pors", "combo",
             "kampanyali", "xüsusi", "acılı", "acısız", "böyük", "kiçik", "orta", "ölçü",
             "yeni", "klassik", "mini", "əla", "super", "qr", "gr.", "qr.", "əd."}
    words = [w.strip("().,!?🌶☕") for w in item_name.lower().split() if w.strip("().,!?🌶☕") not in noise and len(w.strip("().,!?🌶☕")) > 1]

    # Common AZ→EN food term mappings for better Pexels results
    az_to_en = {
        "burger": "burger", "burgerler": "burger", "hot-dog": "hotdog", "hotdog": "hotdog",
        "pizza": "pizza", "salat": "salad", "salatlar": "salad",
        "desert": "dessert", "şirniyyat": "dessert", "tort": "cake", "pasta": "pasta",
        "sup": "soup", "şorba": "soup", "kabab": "kebab", "kebab": "kebab",
        "toyuq": "chicken", "mal": "beef", "dana": "beef", "balıq": "fish",
        "dönər": "doner kebab", "doner": "doner kebab", "shawarma": "shawarma",
        "kartof": "fries", "fri": "french fries", "soğan": "onion rings",
        "nuggets": "chicken nuggets", "tenders": "chicken tenders",
        "qanad": "chicken wings", "kruasan": "croissant", "wrap": "wrap",
        "sandwich": "sandwich", "sushi": "sushi", "tacos": "tacos",
        "içki": "drink", "içkilər": "beverages", "kofe": "coffee", "qəhvə": "coffee",
        "çay": "tea", "limonad": "lemonade", "smoothie": "smoothie",
        "energetik": "energy drink", "redbull": "red bull energy drink",
        "su": "water", "mineral": "mineral water", "moxito": "mojito",
        "kokteyl": "cocktail", "şirə": "juice", "kompot": "compote",
        "sous": "sauce", "souslar": "sauce", "pendir": "cheese",
        "göbələk": "mushroom", "ananas": "pineapple",
    }

    translated = []
    for w in words[:4]:
        if w in az_to_en:
            translated.append(az_to_en[w])
        elif any(c.isascii() and c.isalpha() for c in w):
            # Already English-ish word, keep it
            translated.append(w)
        else:
            # Try partial match
            matched = False
            for az_key, en_val in az_to_en.items():
                if az_key in w or w in az_key:
                    translated.append(en_val)
                    matched = True
                    break
            if not matched and len(w) > 2:
                translated.append(w)

    # Add category translation
    cat_lower = category.lower().strip()
    if cat_lower in az_to_en:
        if az_to_en[cat_lower] not in translated:
            translated.append(az_to_en[cat_lower])
    elif cat_lower and cat_lower not in " ".join(translated):
        translated.append(cat_lower)

    if not translated:
        translated = [category.lower() if category else "food"]

    # Category-aware suffix for better results
    drink_categories = {"içkilər", "içki", "beverages", "drinks", "kofe", "qəhvə", "coffee", "çay", "tea"}
    dessert_categories = {"desert", "şirniyyat", "dessert", "tort", "cake"}
    suffix = "plated served"
    if cat_lower in drink_categories or any(w in drink_categories for w in translated):
        suffix = "glass cup served"
    elif cat_lower in dessert_categories or any(w in dessert_categories for w in translated):
        suffix = "plated dessert"

    translated.append(suffix)
    return " ".join(translated[:5])


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
        # Use ILIKE for Turkish/Azerbaijani case-insensitive matching (İ/i issue)
        query = query.filter(MenuItem.category.ilike(payload.category.strip()))

    items = query.order_by(MenuItem.sort_order.asc()).all()

    if not items:
        raise HTTPException(status_code=404, detail="No menu items found matching the criteria")

    results: list[dict] = []
    assigned_count = 0

    for item in items:
        # Skip items that already have valid images (unless overwrite=True)
        existing_url = str(item.image_url or "").strip()
        has_valid_image = bool(existing_url) and (
            existing_url.startswith("http://") or
            existing_url.startswith("https://") or
            existing_url.startswith("/uploads/") or
            existing_url.startswith("data:image/")
        )
        if has_valid_image and not payload.overwrite:
            results.append({
                "item_id": item.id,
                "item_name": item.item_name,
                "image_url": existing_url,
                "status": "skipped",
            })
            continue

        # Search for a stock photo
        search_query = _build_food_search_query(item.item_name, item.category or "")
        logger.info(f"Auto-image search: item='{item.item_name}' query='{search_query}'")
        image_url = _search_pexels(search_query)

        if not image_url:
            # Try simpler query with just category in English
            cat_en = {"desert": "dessert", "şirniyyat": "dessert", "salatlar": "salad",
                      "burgerlər": "burger", "içkilər": "beverages", "souslar": "sauce",
                      "pasta": "pasta", "pizza": "pizza"}.get(
                str(item.category or "").lower().strip(), str(item.category or "").lower()
            )
            image_url = _search_pexels(f"{cat_en} food plate")

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
