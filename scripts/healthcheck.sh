#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# End-to-end healthcheck — verifies every moving piece of the stack is up
# and talking. Run this after deploys, after server reboots, or whenever
# something feels off.
#
#   ./scripts/healthcheck.sh
#
# Exit code is the number of failed checks; 0 means everything green.
# Prints a coloured ✓ / ✗ per check so it's easy to eyeball.
# -----------------------------------------------------------------------------

set -uo pipefail

FAIL=0
GREEN=$'\033[32m'
RED=$'\033[31m'
GREY=$'\033[90m'
RESET=$'\033[0m'

check() {
  local name="$1"; shift
  local output
  if output=$("$@" 2>&1); then
    printf '%s✓%s %-35s %s%s%s\n' "$GREEN" "$RESET" "$name" "$GREY" "${output:0:60}" "$RESET"
  else
    printf '%s✗%s %-35s %s%s%s\n' "$RED" "$RESET" "$name" "$GREY" "${output:0:60}" "$RESET"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Docker containers ==="
for container in lms-postgres lms-redis lms-ollama; do
  check "$container" bash -c "docker ps --format '{{.Names}}' | grep -q '^${container}$'"
done
# Mongo is optional (P5a).
if docker ps --format '{{.Names}}' | grep -q '^lms-mongo$'; then
  check "lms-mongo" true
fi

echo
echo "=== Data plane ==="
check "postgres  ping"   bash -c "docker exec lms-postgres pg_isready -U lms -d lms > /dev/null"
check "redis     ping"   bash -c "docker exec lms-redis redis-cli ping | grep -q PONG"
check "ollama    version" curl -sf --max-time 3 http://127.0.0.1:11434/api/version
if docker ps --format '{{.Names}}' | grep -q '^lms-mongo$'; then
  check "mongo     ping" bash -c "docker exec lms-mongo mongosh --quiet --norc --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1"
fi

echo
echo "=== Application services (native) ==="
check "api-core  :4000"     curl -sf --max-time 3 http://127.0.0.1:4000/api/v1/healthz
check "web       :3000"     curl -sIf --max-time 3 http://127.0.0.1:3000/vi
check "sandbox   :5001"     curl -sf --max-time 3 http://127.0.0.1:5001/healthz
check "ai-gateway:5002"     curl -sf --max-time 3 http://127.0.0.1:5002/healthz
# data-science optional
if curl -sf --max-time 2 http://127.0.0.1:5003/healthz > /dev/null; then
  check "data-sci  :5003"   curl -sf --max-time 3 http://127.0.0.1:5003/healthz
fi

echo
echo "=== Public edge ==="
check "khohoc.online /healthz" curl -sf --max-time 5 https://khohoc.online/api/v1/healthz
check "khohoc.online /vi"     curl -sIf --max-time 5 https://khohoc.online/vi

echo
echo "=== Metrics (pilot sanity) ==="
if metrics=$(curl -sf --max-time 3 http://127.0.0.1:4000/api/v1/metrics); then
  for key in lms_users_total lms_courses_published lms_submissions_total; do
    value=$(echo "$metrics" | awk -v k="$key" '$1==k {print $2}')
    if [ -n "$value" ]; then
      printf '  %s%s%s = %s\n' "$GREY" "$key" "$RESET" "$value"
    fi
  done
else
  printf '%s✗%s metrics endpoint unreachable\n' "$RED" "$RESET"
  FAIL=$((FAIL + 1))
fi

echo
if [ "$FAIL" -eq 0 ]; then
  printf '%s=== all green (%d checks) ===%s\n' "$GREEN" "12" "$RESET"
  exit 0
fi
printf '%s=== %d check(s) failed ===%s\n' "$RED" "$FAIL" "$RESET"
exit "$FAIL"
