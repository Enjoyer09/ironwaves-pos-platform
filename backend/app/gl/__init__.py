"""Finance v2 — General Ledger core.

Design principles (see docs/finance-v2 plan):
- Single write path: every accounting effect goes through ``engine.create_journal``.
- Immutability: posted journals and their lines are never updated or deleted;
  corrections are made with reversal journals.
- Invariants enforced in code *and* (on PostgreSQL) by database triggers.
- Reports are computed from the GL only.
"""
