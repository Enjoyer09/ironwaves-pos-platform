#!/usr/bin/env sh
set -eu

echo "[migrations] Running alembic upgrade head..."
PYTHON_BIN=""
for candidate in python3.12 python3.11 python3.10 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
      PYTHON_BIN="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "[migrations] ERROR: Python 3.10+ tapılmadı."
  echo "Backend migration üçün Python 3.10 və ya daha yeni versiya lazımdır."
  echo "macOS üçün nümunə:"
  echo "  brew install python@3.12"
  echo "  python3.12 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  exit 1
fi

if ! "$PYTHON_BIN" -m alembic --help >/dev/null 2>&1; then
  echo "[migrations] ERROR: alembic modulunu $PYTHON_BIN ilə tapa bilmədim."
  echo "Əvvəl bunu işlədin:"
  echo "  $PYTHON_BIN -m pip install -r requirements.txt"
  exit 1
fi

"$PYTHON_BIN" -m alembic upgrade head
echo "[migrations] Done."
