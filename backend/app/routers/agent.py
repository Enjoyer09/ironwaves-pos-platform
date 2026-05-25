from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AgentInsight, Tenant, User
from app.services.ai_agent_bg import generate_ai_recipe

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
