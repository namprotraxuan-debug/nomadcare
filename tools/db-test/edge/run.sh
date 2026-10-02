#!/usr/bin/env bash
# =============================================================================
# tools/db-test/edge/run.sh — type-checks and runs the Edge Functions deadman-alert
# and push-dispatch (round 2 R6) without Deno: tsc (strict) with local stubs, then
# Node 18+ with a fake Deno, fake supabase-js, fake Resend and fake web-push.
# Writes the rendered e-mails to OUT_DIR.
# Usage: tools/db-test/edge/run.sh [OUT_DIR]   (default: $TMPDIR/nomadcare-edge-test)
# Needs: node ≥ 18 and tsc (global, or fetched once through npx).
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/nomadcare-edge-test}"
mkdir -p "$OUT"

if command -v tsc >/dev/null 2>&1; then TSC=(tsc); else TSC=(npx -y -p typescript@5 tsc); fi

cat > "$OUT/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "ES2022", "module": "ES2022", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"], "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "skipLibCheck": true, "outDir": "$OUT/build"
  },
  "files": ["$HERE/deno-stubs.d.ts", "$ROOT/supabase/functions/deadman-alert/index.ts"]
}
EOF
echo "== tsc --strict"
"${TSC[@]}" -p "$OUT/tsconfig.json"

# Swap the Deno-only import specifiers for the local fakes.
sed -e 's#^import "jsr:.*$##' -e 's#"npm:@supabase/supabase-js@2"#"./fake-supabase.mjs"#' \
  "$OUT/build/index.js" > "$OUT/index.mjs"
cp "$HERE/fake-supabase.mjs" "$OUT/fake-supabase.mjs"

echo "== run with fakes"
node "$HERE/run.mjs" "$OUT"

# push-dispatch: its own tsc project (one input file keeps the output path flat)
mkdir -p "$OUT/push"
cat > "$OUT/push/tsconfig.json" <<EOF
{
  "compilerOptions": {
    "target": "ES2022", "module": "ES2022", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"], "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "skipLibCheck": true, "outDir": "$OUT/push/build"
  },
  "files": ["$HERE/deno-stubs.d.ts", "$ROOT/supabase/functions/push-dispatch/index.ts"]
}
EOF
echo "== tsc --strict (push-dispatch)"
"${TSC[@]}" -p "$OUT/push/tsconfig.json"
sed -e 's#^import "jsr:.*$##' -e 's#"npm:@supabase/supabase-js@2"#"./fake-supabase.mjs"#' -e 's#"npm:web-push@3"#"./fake-web-push.mjs"#' \
  "$OUT/push/build/index.js" > "$OUT/push/push.mjs"
cp "$HERE/fake-supabase.mjs" "$HERE/fake-web-push.mjs" "$OUT/push/"
echo "== run push-dispatch with fakes"
node "$HERE/run-push.mjs" "$OUT/push"
