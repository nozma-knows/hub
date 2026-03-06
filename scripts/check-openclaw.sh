#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT_DIR/.env"; set +a
fi

if [[ -z "${OPENCLAW_BASE_URL:-}" ]]; then
  echo "OPENCLAW_BASE_URL is missing. Set it in .env first."
  exit 1
fi

if [[ -z "${OPENCLAW_API_KEY:-}" ]]; then
  echo "OPENCLAW_API_KEY is missing. Set it in .env first."
  exit 1
fi

echo "Checking OpenClaw connectivity at: $OPENCLAW_BASE_URL"

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

paths=(
  "/health"
  "/api/health"
  "/agents"
  "/api/agents"
  "/v1/agents"
  "/control/agents"
  "/api/control/agents"
  "/v1/control/agents"
)

for path in "${paths[@]}"; do
  status="$(curl -sS -o "$tmp_file" -w "%{http_code}" \
    -H "Authorization: Bearer $OPENCLAW_API_KEY" \
    -H "X-API-Key: $OPENCLAW_API_KEY" \
    -H "X-Gateway-Token: $OPENCLAW_API_KEY" \
    "$OPENCLAW_BASE_URL$path" || true)"
  body_preview="$(head -c 140 "$tmp_file" | tr '\n' ' ')"
  printf "%s %s :: %s\n" "$status" "$path" "$body_preview"
done

echo ""
echo "Expected result: at least one 200 response for health/agent endpoints."
