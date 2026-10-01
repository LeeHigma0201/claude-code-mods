#!/usr/bin/env bash
# smoke.sh: validate (strict) and run the test suite of every mod under mods/.
# Usage: scripts/smoke.sh [mod-name ...]   Exit 0 only when every step passes.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/mods" || exit 1
mods=("$@"); [ ${#mods[@]} -eq 0 ] && mods=(*/)
fail=0
for m in "${mods[@]}"; do
  m="${m%/}"
  if claude plugin validate --strict "./$m" >"${TMPDIR:-/tmp}/smoke-validate.$$" 2>&1; then
    echo "PASS validate $m"
  else
    echo "FAIL validate $m"; sed 's/^/    /' "${TMPDIR:-/tmp}/smoke-validate.$$"; fail=1
  fi
  if out=$(claude plugin test "./$m" 2>&1); then
    echo "PASS test     $m ($(printf '%s\n' "$out" | grep -c '^(pass)') passed)"
  else
    echo "FAIL test     $m"; printf '%s\n' "$out" | grep -E '^\(fail\)|Error|Expected|Received' | sed 's/^/    /'; fail=1
  fi
done
rm -f "${TMPDIR:-/tmp}/smoke-validate.$$"
exit $fail
