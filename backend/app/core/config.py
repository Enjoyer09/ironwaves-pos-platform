from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Social Bee POS API"
    app_env: str = "development"
    app_url: str = "http://localhost:8000"

    database_url: str

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    superadmin_username: str = "ironwaves_owner"
    superadmin_password: str
    superadmin_email: str = "owner@ironwaves.store"
    reset_superadmin_on_startup: bool = False
    seed_demo_users: bool = False

    default_tenant_slug: str = "socialbee"
    default_tenant_name: str = "Social Bee"
    default_tenant_domain: str = "socialbee.ironwaves.store"

    resend_api_key: str | None = None
    email_from: str = "no-reply@ironwaves.store"

    # Multi-tenant should be enabled by default. Set true only for per-deployment single-tenant mode.
    single_tenant_mode: bool = False
    single_tenant_id: str = ""
    allow_legacy_tenant_header_fallback: bool = False

    cors_origins: str = "http://localhost:5173"


settings = Settings()
