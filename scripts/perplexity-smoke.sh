#!/usr/bin/env bash
# One real call to the Perplexity Agent API, shaped like the Climb guide's request (api/_lib/perplexity.ts),
# to check the key, the credits and the response shape. Prints only the HTTP status and the response's shape
# (output item types, answer length, citations); never the key and never the answer text.
#
#   export PERPLEXITY_API_KEY=...        # create one in the API console: https://console.perplexity.ai
#   PERPLEXITY_EFFORT=low scripts/perplexity-smoke.sh      # effort is optional (default low)
#
# Costs a few cents (one web search plus a short answer). Calls once and never retries.

set -euo pipefail

if [ -z "${PERPLEXITY_API_KEY:-}" ]; then
  cat >&2 <<'MSG'
PERPLEXITY_API_KEY is not set.
Create a key in the Perplexity API console (https://console.perplexity.ai, API Keys), add paid credit there
(the Agent API needs it), then run:
  export PERPLEXITY_API_KEY=pplx-...
  scripts/perplexity-smoke.sh
MSG
  exit 1
fi

effort="${PERPLEXITY_EFFORT:-low}"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

instructions="You write short, current, web-grounded facts about a real cycling climb. Answer as JSON with \"summary\" (2 to 4 short plain sentences) and \"facts\" (0 to 5 short plain facts). Plain text only. Cite sources inline with numbered brackets like [1], using the ids of the search results you used. Say as of what date anything time-sensitive is true. If you cannot find reliable information, say so; never invent anything."
input="Today's date is $(date -u +%Y-%m-%d).
The climb: Alpe d'Huez, Isere, French Alps, France.
Give the history of this climb and its most famous race moments, with years."

request="$(jq -n --arg effort "$effort" --arg instructions "$instructions" --arg input "$input" '{
  effort: $effort,
  instructions: $instructions,
  input: $input,
  max_output_tokens: 900,
  store: false,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "climb_guide",
      schema: {
        type: "object",
        properties: { summary: { type: "string" }, facts: { type: "array", items: { type: "string" } } },
        required: ["summary", "facts"],
        additionalProperties: false
      }
    }
  }
}')"

# --fail-with-body makes curl exit non-zero on HTTP errors; the status and body are still wanted, so don't stop on it.
set +e
status="$(curl --silent --show-error --fail-with-body --max-time 40 \
  --output "$body_file" --write-out '%{http_code}' \
  https://api.perplexity.ai/v1/agent \
  -H "Authorization: Bearer ${PERPLEXITY_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d "$request")"
curl_exit=$?
set -e

echo "HTTP status: ${status:-none} (effort: ${effort})"

if [ "$curl_exit" -ne 0 ]; then
  message="$(jq -r '.error.message // empty' "$body_file" 2>/dev/null || true)"
  case "${status:-}" in
    401) echo "Unauthorized: the key is wrong or revoked. Create a new one in the API console (https://console.perplexity.ai)." >&2 ;;
    403) echo "Forbidden: ${message:-no message}" >&2
         echo "If this says the Agent API requires paid credits, add paid credit at https://console.perplexity.ai and try again." >&2 ;;
    429) echo "Rate limited. Wait for Retry-After and try again later; this script does not retry." >&2 ;;
    *)   echo "Request failed (curl exit ${curl_exit}): ${message:-no message from the API}" >&2 ;;
  esac
  exit 1
fi

jq -r '
  def answer: [.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text") | .text] | join("");
  "output item types: \([.output[]?.type] | join(", "))",
  "model: \(.model // "unknown")  effort: \(.effort // "unknown")  status: \(.status // "unknown")",
  "answer length: \(answer | length) characters",
  "answer is JSON with summary and facts: \(answer | (try (fromjson | has("summary") and has("facts")) catch false))",
  "search results: \([.output[]? | select(.type == "search_results") | .results[]?] | length)",
  "citations (url_citation annotations): \([.output[]? | select(.type == "message") | .content[]? | .annotations[]? | select(.type == "url_citation")] | length)",
  "inline [n] markers in the answer: \(answer | [match("\\[(?:web:)?[0-9]+\\]"; "g")] | length)",
  "total cost (USD): \(.usage.cost.total_cost // "n/a")"
' "$body_file"
