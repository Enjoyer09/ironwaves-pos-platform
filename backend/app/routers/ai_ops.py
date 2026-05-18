from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.deps import get_current_user, get_tenant
from app.models import Tenant, User
from app.services.ollama_service import (
    cloud_generate_once as _ollama_cloud_generate_once,
    find_servers_for_model as _ollama_find_servers_for_model,
    generate_once as _ollama_generate_once,
)
from app.services.opencode_service import (
    default_model_id as _opencode_default_model_id,
    generate_text as _opencode_generate_text,
    get_allowed_models as _opencode_get_allowed_models,
    normalize_opencode_error as _normalize_opencode_error,
)


router = APIRouter(prefix="/api/v1/ops/ai", tags=["operations-ai"])


def _ensure_manager(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail="Manager access required")


class OllamaFreeGenerateIn(BaseModel):
    model: str = Field(default="llama3.2:3b", min_length=2, max_length=128)
    prompt: str = Field(min_length=3, max_length=12000)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    num_predict: int = Field(default=256, ge=16, le=2048)
    timeout_seconds: int = Field(default=30, ge=5, le=120)


class OllamaGenerateIn(BaseModel):
    model: str = Field(default="gpt-oss:20b", min_length=2, max_length=128)
    prompt: str = Field(min_length=3, max_length=12000)
    api_key: str = Field(min_length=8, max_length=512)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    num_predict: int = Field(default=256, ge=16, le=4096)
    timeout_seconds: int = Field(default=35, ge=5, le=120)


class OpenCodeGenerateIn(BaseModel):
    model: str | None = Field(default=None, max_length=128)
    prompt: str = Field(min_length=3, max_length=20000)
    system: str | None = Field(default="", max_length=4000)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=800, ge=16, le=4096)
    timeout_seconds: int = Field(default=45, ge=5, le=120)


@router.post("/ollamafreeapi/generate")
def ollamafreeapi_generate(
    payload: OllamaFreeGenerateIn,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    model = str(payload.model or "llama3.2:3b").strip()
    prompt = str(payload.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    servers = _ollama_find_servers_for_model(model)
    if not servers:
        raise HTTPException(status_code=404, detail=f"OllamaFreeAPI server tapılmadı: {model}")

    errors = []
    for server in servers[:6]:
        server_url = str(server.get("server_url") or "").strip()
        if not server_url:
            continue
        try:
            text = _ollama_generate_once(
                server_url=server_url,
                model=model,
                prompt=prompt,
                temperature=payload.temperature,
                num_predict=payload.num_predict,
                timeout_seconds=payload.timeout_seconds,
            )
            return {
                "success": True,
                "tenant_id": tenant.id,
                "model": model,
                "server_url": server_url,
                "tokens_per_second": server.get("tokens_per_second"),
                "text": text,
            }
        except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError) as exc:
            errors.append(f"{server_url}: {str(exc)}")
            continue
        except Exception as exc:
            errors.append(f"{server_url}: {str(exc)}")
            continue

    detail = " ; ".join(errors[:3]) if errors else "No usable server"
    raise HTTPException(status_code=502, detail=f"OllamaFreeAPI cavab vermədi: {detail}")


@router.post("/ollama/generate")
def ollama_generate(
    payload: OllamaGenerateIn,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    model = str(payload.model or "gpt-oss:20b").strip()
    prompt = str(payload.prompt or "").strip()
    api_key = str(payload.api_key or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    if not api_key:
        raise HTTPException(status_code=400, detail="Ollama API key is required")
    try:
        text = _ollama_cloud_generate_once(
            api_key=api_key,
            model=model,
            prompt=prompt,
            temperature=payload.temperature,
            num_predict=payload.num_predict,
            timeout_seconds=payload.timeout_seconds,
        )
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama Cloud HTTP error: {exc.code}")
    except (URLError, TimeoutError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Ollama Cloud error: {str(exc)}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Ollama Cloud çağırışı uğursuz oldu: {str(exc)}")

    return {
        "success": True,
        "tenant_id": tenant.id,
        "model": model,
        "provider": "ollama",
        "text": text,
    }


@router.get("/opencode/models")
def opencode_models(
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    return {
        "success": True,
        "tenant_id": tenant.id,
        "provider": "opencode",
        "default_model": _opencode_default_model_id(),
        "models": _opencode_get_allowed_models(),
    }


@router.post("/opencode/generate")
def opencode_generate(
    payload: OpenCodeGenerateIn,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    model = str(payload.model or _opencode_default_model_id()).strip()
    try:
        text = _opencode_generate_text(
            model=model,
            prompt=payload.prompt,
            system=payload.system or "",
            temperature=payload.temperature,
            max_tokens=payload.max_tokens,
            timeout_seconds=payload.timeout_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=_normalize_opencode_error(exc))

    return {
        "success": True,
        "tenant_id": tenant.id,
        "provider": "opencode",
        "model": model,
        "text": text,
    }
