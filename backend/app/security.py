from datetime import datetime, timedelta, timezone
import hashlib

from fastapi import Request
from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _normalized_jwt_algorithm() -> str:
    return str(settings.jwt_algorithm or "HS256").strip().upper()


def _normalized_pem(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    return raw.replace("\\n", "\n")


def _jwt_signing_key() -> str:
    algorithm = _normalized_jwt_algorithm()
    if algorithm.startswith("RS"):
        private_key = _normalized_pem(settings.jwt_private_key)
        if not private_key:
            raise RuntimeError("RS JWT signing is enabled, but jwt_private_key is missing")
        return private_key
    return settings.jwt_secret


def _jwt_verification_key() -> str:
    algorithm = _normalized_jwt_algorithm()
    if algorithm.startswith("RS"):
        public_key = _normalized_pem(settings.jwt_public_key)
        if not public_key:
            raise RuntimeError("RS JWT verification is enabled, but jwt_public_key is missing")
        return public_key
    return settings.jwt_secret


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def validate_password_policy(password: str, min_length: int | None = None) -> None:
    value = str(password or "")
    required_min_length = max(8, int(min_length or settings.password_min_length or 10))
    if len(value) < required_min_length:
        raise ValueError(f"Şifrə ən azı {required_min_length} simvol olmalıdır")

    checks = [
        any(ch.islower() for ch in value),
        any(ch.isupper() for ch in value),
        any(ch.isdigit() for ch in value),
        any(not ch.isalnum() for ch in value),
    ]
    required_classes = min(4, max(1, int(settings.password_required_character_classes or 4)))
    if sum(1 for ok in checks if ok) < required_classes:
        if required_classes >= 4:
            raise ValueError("Şifrə böyük hərf, kiçik hərf, rəqəm və simvol ehtiva etməlidir")
        raise ValueError(
            f"Şifrə ən azı {required_classes} növ simvoldan ibarət olmalıdır (böyük/kiçik hərf, rəqəm, simvol)"
        )


def create_access_token(subject: str, tenant_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": subject, "tenant_id": tenant_id, "role": role, "type": "access", "exp": exp}
    return jwt.encode(payload, _jwt_signing_key(), algorithm=_normalized_jwt_algorithm())


def create_refresh_token(subject: str, tenant_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days)
    payload = {"sub": subject, "tenant_id": tenant_id, "type": "refresh", "exp": exp}
    return jwt.encode(payload, _jwt_signing_key(), algorithm=_normalized_jwt_algorithm())


def create_trusted_device_token(subject: str, tenant_id: str, device_hash: str, ip: str, days: int = 30) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=days)
    payload = {
        "sub": subject,
        "tenant_id": tenant_id,
        "device_hash": device_hash,
        "ip": ip,
        "type": "trusted_device",
        "exp": exp,
    }
    return jwt.encode(payload, _jwt_signing_key(), algorithm=_normalized_jwt_algorithm())


def decode_token(token: str) -> dict:
    return jwt.decode(token, _jwt_verification_key(), algorithms=[_normalized_jwt_algorithm()])


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else ""
