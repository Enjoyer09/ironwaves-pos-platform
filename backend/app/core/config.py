from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "iRonWaves POS API"
    app_env: str = "development"
    app_url: str = "http://localhost:8000"
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0
    sentry_profiles_sample_rate: float = 0.0
    metrics_bearer_token: str | None = None

    database_url: str
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout: int = 15
    db_pool_recycle_seconds: int = 1800
    db_pool_pre_ping: bool = True
    db_statement_timeout_ms: int = 30000
    startup_schema_guard_enabled: bool = True
    startup_create_all_enabled: bool = True
    startup_runtime_migrations_enabled: bool = False
    startup_schema_version: int = 2026041301
    startup_data_retention_cleanup_enabled: bool = True
    startup_data_retention_cleanup_interval_hours: int = 24

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_private_key: str | None = None
    jwt_public_key: str | None = None
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    pin_min_length: int = 6
    pin_max_failed_attempts: int = 5
    pin_lockout_minutes: int = 15
    csrf_origin_check_enabled: bool = True
    security_headers_enabled: bool = True
    request_rate_limit_per_minute: int = 240
    auth_rate_limit_per_minute: int = 30
    redis_url: str | None = None
    redis_required_in_production: bool = True
    password_min_length: int = 10
    password_required_character_classes: int = 4
    data_retention_days: int = 365
    audit_log_retention_days: int = 730
    customer_consent_required: bool = True

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
    demo_admin_password: str = "Demo1234!!"
    demo_manager_username: str = "demo_manager"
    demo_manager_password: str = "Demo1234!!"
    demo_staff_username: str = "demo_staff"
    demo_staff_pin: str = "135790"
    demo_kitchen_username: str = "demo_kitchen"
    demo_kitchen_pin: str = "246802"

    resend_api_key: str | None = None
    email_from: str = "no-reply@ironwaves.store"

    # Multi-tenant should be enabled by default. Set true only for per-deployment single-tenant mode.
    single_tenant_mode: bool = False
    single_tenant_id: str = ""
    allow_legacy_tenant_header_fallback: bool = False

    cors_origins: str = "http://localhost:5173"


settings = Settings()
