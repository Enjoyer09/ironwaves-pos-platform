from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "iRonWaves POS API"
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

    seed_default_tenant: bool = False
    default_tenant_slug: str = "default"
    default_tenant_name: str = "Default Workspace"
    default_tenant_domain: str = "default.ironwaves.store"
    platform_tenant_slug: str = "super"
    platform_tenant_name: str = "iRonWaves Platform"
    platform_tenant_domain: str = "super.ironwaves.store"

    demo_tenant_enabled: bool = False
    demo_tenant_slug: str = "demo"
    demo_tenant_name: str = "iRonWaves Demo"
    demo_tenant_domain: str = "demo.ironwaves.store"
    reset_demo_users_on_startup: bool = True
    demo_admin_username: str = "demo_admin"
    demo_admin_password: str = "Demo1234!"
    demo_manager_username: str = "demo_manager"
    demo_manager_password: str = "Demo1234!"
    demo_staff_username: str = "demo_staff"
    demo_staff_pin: str = "1111"
    demo_kitchen_username: str = "demo_kitchen"
    demo_kitchen_pin: str = "2222"

    resend_api_key: str | None = None
    email_from: str = "no-reply@ironwaves.store"

    # Multi-tenant should be enabled by default. Set true only for per-deployment single-tenant mode.
    single_tenant_mode: bool = False
    single_tenant_id: str = ""
    allow_legacy_tenant_header_fallback: bool = False

    cors_origins: str = "http://localhost:5173"


settings = Settings()
