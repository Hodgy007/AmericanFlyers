#!/usr/bin/env bash
# One real call to the Vercel AI Gateway (Perplexity Sonar), shaped like the Climb guide's request
# (api/_lib/perplexity.ts), to check the credentials and where the gateway puts the sources. Prints only the
# HTTP status and the response's shape (answer length, where citations are, counts); never the token and
# never the answer text.
#
# Credentials, either one:
#   export AI_GATEWAY_API_KEY=...   # Vercel dashboard > AI Gateway > API keys
#   vercel env pull .env.local && set -a && . ./.env.local && set +a   # gives VERCEL_OIDC_TOKEN (valid for hours)
#
#   scripts/climb-guide-smoke.sh
#   CLIMB_GUIDE_MODEL=perplexity/sonar-pro scripts/climb-guide-smoke.sh      # another model, optional
#
# Costs a fraction of a cent. Calls once and never retries.

set -euo pipefail

token="${AI_GATEWAY_API_KEY:-${VERCEL_OIDC_TOKEN:-}}"
if [ -z "$token" ]; then
  cat >&2 <<'MSG'
AI_GATEWAY_API_KEY is not set (and there is no VERCEL_OIDC_TOKEN).
Create a key in the Vercel dashboard (AI Gateway > API keys) and run:
  export AI_GATEWAY_API_KEY=...
  scripts/climb-guide-smoke.sh
or pull an OIDC token for the project with `vercel env pull .env.local`, load it
(set -a; . ./.env.local; set +a) and run the script again.
MSG
  exit 1
fi

model="${CLIMB_GUIDE_MODEL:-perplexity/sonar}"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

system="You write short, current, web-grounded facts about a real cycling climb. Reply with one JSON object and nothing else: {\"summary\": string, \"facts\": string[]}. Plain text only. Cite sources inline with numbered brackets like [1], by position in your list of sources. Say as of what date anything time-sensitive is true. If you cannot find reliable information, say so; never invent anything."
user="Today's date is $(date -u +%Y-%m-%d).
The climb: Alpe d'Huez, Isere, French Alps, France.
Give the history of this climb and its most famous race moments, with years."

request="$(jq -n --arg model "$model" --arg system "$system" --arg user "$user" '{
  model: $model,
  max_tokens: 900,
  messages: [ { role: "system", content: $system }, { role: "user", content: $user } ]
}')"

# --fail-with-body makes curl exit non-zero on HTTP errors; the status and body are still wanted, so don't stop on it.
set +e
status="$(curl --silent --show-error --fail-with-body --max-time 40 \
  --output "$body_file" --write-out '%{http_code}' \
  https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer ${token}" \
  -H 'Content-Type: application/json' \
  -d "$request")"
curl_exit=$?
set -e

echo "HTTP status: ${status:-none} (model: ${model})"

if [ "$curl_exit" -ne 0 ]; then
  message="$(jq -r '.error.message // empty' "$body_file" 2>/dev/null || true)"
  case "${status:-}" in
    401|403) echo "Not allowed: ${message:-no message}. Check the key or OIDC token (an OIDC token from vercel env pull expires; pull it again)." >&2 ;;
    402)     echo "The gateway needs credits: ${message:-no message}. Add credits in the Vercel dashboard (AI Gateway)." >&2 ;;
    429)     echo "Rate limited. Wait and try later; this script does not retry." >&2 ;;
    *)       echo "Request failed (curl exit ${curl_exit}): ${message:-no message from the gateway}" >&2 ;;
  esac
  exit 1
fi

jq -r '
  def answer: (.choices[0].message.content // "");
  def msg: (.choices[0].message // {});
  "model: \(.model // "unknown")  finish: \(.choices[0].finish_reason // "unknown")",
  "top-level keys: \(keys | join(", "))",
  "message keys: \(msg | keys | join(", "))",
  "answer length: \(answer | length) characters",
  "answer is JSON with summary and facts: \(answer | (try (fromjson | has("summary") and has("facts")) catch false))",
  "citations (top-level, urls): \((.citations // []) | length)",
  "search_results (top-level): \((.search_results // []) | length)",
  "annotations (message, url_citation): \([msg.annotations[]? | select(.type == "url_citation")] | length)",
  "provider_metadata keys (message): \((msg.provider_metadata // {}) | keys | join(", "))",
  "inline [n] markers in the answer: \(answer | [match("\\[(?:web:)?[0-9]+\\]"; "g")] | length)",
  "usage: \(.usage // {} | tostring)"
' "$body_file"
