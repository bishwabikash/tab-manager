#!/usr/bin/env bash
# Prints a Chrome Web Store API access token, or Google's error and exits 1.
set -euo pipefail

: "${CLIENT_ID:?CHROME_CLIENT_ID secret is not set}"
: "${CLIENT_SECRET:?CHROME_CLIENT_SECRET secret is not set}"
: "${REFRESH_TOKEN:?CHROME_REFRESH_TOKEN secret is not set}"

RESPONSE=$(curl -sS -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "refresh_token=${REFRESH_TOKEN}" \
  -d "grant_type=refresh_token")

echo "$RESPONSE" | python3 -c '
import json, sys
r = json.load(sys.stdin)
token = r.get("access_token")
if not token:
    error = r.get("error")
    detail = r.get("error_description", "")
    print(f"::error::Google rejected the credentials: {error}: {detail}", file=sys.stderr)
    if error == "invalid_grant":
        print("::error::The refresh token is expired or revoked. Generate a new one and update CHROME_REFRESH_TOKEN.", file=sys.stderr)
    sys.exit(1)
scope = r.get("scope", "chromewebstore")
if "chromewebstore" not in scope:
    print(f"::error::Token lacks the chromewebstore scope (got: {scope}).", file=sys.stderr)
    sys.exit(1)
print(f"::add-mask::{token}", file=sys.stderr)
print(token)
'
