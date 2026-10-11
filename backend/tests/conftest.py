"""Kolleksiya əvvəli mühit dəyişənləri.

`app.core.config` import anında `settings = Settings()` yaradır — `DATABASE_URL`,
`JWT_SECRET`, `SUPERADMIN_PASSWORD` olmadan kolleksiya ValidationError ilə
dayanır. Testlərdəki `_bootstrap_env()` bu dəyərləri testin **içində** qurur,
amma `app.models` importu daha erkən baş verir. Dəyərlər `_bootstrap_env` ilə
eynidir; xarici mühitdən gələn dəyər üstünlük tutur (setdefault).
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")
