"""Release gate helper for audit closure.

Checks:
1) Alembic `current` vs `heads`
2) Optional backend smoke test runner

Usage:
  DATABASE_URL=postgresql://... \
  JWT_SECRET=... \
  SUPERADMIN_PASSWORD=... \
  python scripts/release_gate_check.py

Optional:
  RUN_SMOKE_TEST=1 BASE_URL=http://localhost:8000 SUPERADMIN_USERNAME=... TENANT_DOMAIN=... python scripts/release_gate_check.py
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _run(cmd: list[str], env: dict[str, str] | None = None) -> tuple[int, str]:
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        env=env or os.environ.copy(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return proc.returncode, proc.stdout.strip()


def _print_ok(msg: str) -> None:
    print(f"[OK] {msg}")


def _print_fail(msg: str, output: str) -> None:
    print(f"[FAIL] {msg}")
    if output:
        print(output)


_REV_RE = re.compile(r"^([0-9a-zA-Z_]+)\b")


def _extract_revisions(output: str) -> set[str]:
    revisions: set[str] = set()
    for line in output.splitlines():
        text = line.strip()
        if not text or text.startswith("INFO"):
            continue
        match = _REV_RE.match(text)
        if match:
            revisions.add(match.group(1))
    return revisions


def main() -> None:
    env = os.environ.copy()
    env.setdefault("DATABASE_URL", "sqlite:////tmp/ironwaves_ci_test.db")

    code, heads_out = _run([".venv/bin/alembic", "-c", "alembic.ini", "heads"], env=env)
    if code != 0:
        _print_fail("alembic heads", heads_out)
        raise SystemExit(1)
    heads = _extract_revisions(heads_out)
    if not heads:
        _print_fail("alembic heads parse", heads_out)
        raise SystemExit(1)

    code, current_out = _run([".venv/bin/alembic", "-c", "alembic.ini", "current"], env=env)
    if code != 0:
        _print_fail("alembic current", current_out)
        raise SystemExit(1)
    current = _extract_revisions(current_out)
    if not current:
        _print_fail(
            "alembic current is empty",
            "No applied revision found. Run: .venv/bin/alembic -c alembic.ini upgrade head",
        )
        raise SystemExit(1)

    if current != heads:
        _print_fail("alembic current != heads", f"current={sorted(current)} heads={sorted(heads)}")
        raise SystemExit(1)
    _print_ok(f"alembic current == heads ({', '.join(sorted(heads))})")

    if os.getenv("RUN_SMOKE_TEST", "0").strip() == "1":
        code, out = _run([".venv/bin/python", "scripts/smoke_test.py"], env=env)
        if code != 0:
            _print_fail("smoke_test.py", out)
            raise SystemExit(1)
        _print_ok("smoke_test.py passed")

    print("Release gate checks passed.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
