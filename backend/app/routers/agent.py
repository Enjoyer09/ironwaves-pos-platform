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

def _translate_menu_items_to_english(items: list) -> dict[str, str]:
    """Use AI to translate menu item names from Azerbaijani to English food search terms."""
    from app.services.opencode_service import generate_text, default_model_id

    if not items:
        return {}

    # Build a batch prompt
    item_lines = []
    for i, item in enumerate(items[:30]):  # Limit to 30 items per batch
        item_lines.append(f"{i+1}. {item.item_name}")

    prompt = f"""Translate these restaurant menu item names from Azerbaijani to English. 
For each item, provide a short English food/drink description suitable for searching stock photos.
Focus on the actual food/drink, not sizes or quantities.

Examples:
- "Latte orta" → "latte coffee"
- "Toyuq burger tək" → "chicken burger"  
- "Energetik (redbull 225 ml)" → "red bull energy drink can"
- "Bal pörtləməsi" → "honey glazed dessert"
- "Kartof fri" → "french fries"
- "Çoban salatı" → "shepherd salad vegetables"

Menu items:
{chr(10).join(item_lines)}

Reply ONLY with numbered translations, one per line. Format: "1. english description"
No explanations, no extra text."""

    try:
        result = generate_text(
            model=default_model_id(),
            prompt=prompt,
            system="You are a food menu translator. Translate Azerbaijani restaurant menu items to English food descriptions for stock photo search. Be concise and specific about the food/drink.",
            temperature=0.1,
            max_tokens=1200,
            timeout_seconds=30,
        )

        # Parse response
        translations: dict[str, str] = {}
        for line in result.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            # Parse "1. english description" or "1) english description"
            parts = line.split(".", 1) if "." in line[:4] else line.split(")", 1)
            if len(parts) == 2:
                try:
                    idx = int(parts[0].strip()) - 1
                    if 0 <= idx < len(items):
                        translation = parts[1].strip().strip('"').strip("'")
                        if translation:
                            translations[items[idx].id] = translation
                except (ValueError, IndexError):
                    continue

        logger.info(f"AI translated {len(translations)}/{len(items)} menu items to English")
        return translations

    except Exception as e:
        logger.warning(f"AI translation failed: {e}")
        return {}

def _search_unsplash(query: str) -> str | None:
    """Search Unsplash for a food photo. Returns regular-sized URL."""
    access_key = app_settings.unsplash_access_key
    if not access_key:
        return None
    try:
        url = f"https://api.unsplash.com/search/photos?query={urllib_request.quote(query)}&per_page=10&orientation=landscape&content_filter=high"
        req = urllib_request.Request(url, headers={
            "Authorization": f"Client-ID {access_key}",
            "Accept-Version": "v1",
        })
        with urllib_request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            logger.info(f"Unsplash response for '{query}': {len(results)} results, total={data.get('total', 0)}")

            if not results:
                return None

            # Food relevance scoring
            food_signals = {
                "food", "dish", "plate", "bowl", "cup", "glass", "drink", "beverage",
                "coffee", "tea", "juice", "cocktail", "beer", "wine", "water",
                "burger", "pizza", "pasta", "salad", "soup", "cake", "dessert",
                "sandwich", "wrap", "sushi", "rice", "bread", "meat", "chicken",
                "fish", "fries", "sauce", "cheese", "chocolate", "ice cream",
                "restaurant", "cafe", "menu", "served", "cooking", "kitchen",
                "delicious", "tasty", "gourmet", "homemade", "fresh",
                "breakfast", "lunch", "dinner", "snack", "appetizer", "meal",
            }

            best_url = None
            best_score = -1

            for photo in results:
                desc = str(photo.get("description") or "").lower()
                alt = str(photo.get("alt_description") or "").lower()
                tags = " ".join(str(t.get("title", "")) for t in (photo.get("tags") or []))
                combined = f"{desc} {alt} {tags}".lower()

                score = sum(1 for signal in food_signals if signal in combined)
                if score == 0:
                    continue

                if score > best_score:
                    best_score = score
                    # Use "regular" size (1080px width) — good for menu
                    best_url = str(photo.get("urls", {}).get("regular", ""))

            if best_url:
                logger.info(f"Unsplash best match for '{query}': score={best_score}")
                return best_url

            # Fallback to first result
            return str(results[0].get("urls", {}).get("regular", "")) or None

    except HTTPError as e:
        logger.error(f"Unsplash HTTP error for '{query}': {e.code} {e.reason}")
    except URLError as e:
        logger.error(f"Unsplash URL error for '{query}': {e.reason}")
    except Exception as e:
        logger.error(f"Unsplash unexpected error for '{query}': {type(e).__name__}: {e}")
    return None


def _search_stock_photo(query: str) -> str | None:
    """Search for food photo — tries Unsplash first (better quality), falls back to Pexels."""
    # Try Unsplash first (higher quality food photos)
    url = _search_unsplash(query)
    if url:
        return url
    # Fallback to Pexels
    return _search_pexels(query)

def _search_pexels(query: str, per_page: int = 1) -> str | None:
    """Search Pexels for a food/drink photo suitable for a restaurant menu."""
    api_key = app_settings.pexels_api_key
    if not api_key:
        return None
    try:
        url = f"https://api.pexels.com/v1/search?query={urllib_request.quote(query)}&per_page=15&orientation=landscape&size=medium"
        req = urllib_request.Request(url, headers={
            "Authorization": api_key,
            "User-Agent": "iRonWaves-POS/1.0",
        })
        with urllib_request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            photos = data.get("photos", [])
            logger.info(f"Pexels response for '{query}': {len(photos)} photos, total_results={data.get('total_results', 0)}")

            if not photos:
                return None

            # Food/drink relevance keywords — photo must match at least one
            food_signals = {
                "food", "dish", "plate", "bowl", "cup", "glass", "drink", "beverage",
                "coffee", "tea", "juice", "cocktail", "beer", "wine", "water",
                "burger", "pizza", "pasta", "salad", "soup", "cake", "dessert",
                "sandwich", "wrap", "sushi", "rice", "bread", "meat", "chicken",
                "fish", "fries", "sauce", "cheese", "chocolate", "ice cream",
                "restaurant", "cafe", "menu", "served", "cooking", "kitchen",
                "delicious", "tasty", "gourmet", "homemade", "fresh", "organic",
                "breakfast", "lunch", "dinner", "snack", "appetizer", "meal",
                "table", "wooden", "plated", "garnish", "ingredient",
            }

            # Score each photo by food relevance
            best_url = None
            best_score = -1

            for photo in photos:
                alt = str(photo.get("alt") or "").lower()
                url_str = str(photo.get("url") or "").lower()
                combined = f"{alt} {url_str}"

                # Count how many food signals match
                score = sum(1 for signal in food_signals if signal in combined)

                # Reject photos with no food signals at all
                if score == 0:
                    continue

                if score > best_score:
                    best_score = score
                    best_url = str(photo.get("src", {}).get("medium", ""))

            if best_url:
                logger.info(f"Pexels best match for '{query}': score={best_score}")
                return best_url

            # Fallback: if no scored match, take first result (better than nothing)
            fallback = str(photos[0].get("src", {}).get("medium", ""))
            return fallback if fallback else None

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

    # AI translate all item names to English for better search results
    items_to_process = [item for item in items if not (
        str(item.image_url or "").strip() and (
            str(item.image_url or "").startswith("http://") or
            str(item.image_url or "").startswith("https://") or
            str(item.image_url or "").startswith("/uploads/") or
            str(item.image_url or "").startswith("data:image/")
        ) and not payload.overwrite
    )]
    ai_translations = _translate_menu_items_to_english(items_to_process) if items_to_process else {}

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

        # Use AI translation if available, otherwise fall back to keyword mapping
        ai_query = ai_translations.get(item.id, "")
        if ai_query:
            search_query = ai_query
        else:
            search_query = _build_food_search_query(item.item_name, item.category or "")

        logger.info(f"Auto-image search: item='{item.item_name}' query='{search_query}'")
        image_url = _search_stock_photo(search_query)

        if not image_url:
            # Try simpler query — just the food type
            fallback_query = ai_query.split()[0] if ai_query else str(item.category or "food")
            cat_en = {"desert": "dessert", "şirniyyat": "dessert", "salatlar": "salad",
                      "burgerlər": "burger", "içkilər": "beverages", "souslar": "sauce",
                      "pasta": "pasta", "pizza": "pizza"}.get(
                str(item.category or "").lower().strip(), fallback_query
            )
            image_url = _search_stock_photo(f"{cat_en} restaurant")

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
