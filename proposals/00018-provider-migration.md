# Provider Migration: DeepSeek Direct → Requesty + DeepInfra

Switch Franklin's LLM provider from DeepSeek's China-based API to the
Requesty router → DeepInfra (US inference) path. Improves data privacy by keeping
all prompt/response traffic under US jurisdiction. Single-tier: all quests use the
safe path.

## Motivation

- **Current**: `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` — prompts and
  responses flow through DeepSeek servers in China, subject to Chinese data laws
  (Cybersecurity Law, Data Security Law, PIPL).
- **Target**: `ANTHROPIC_BASE_URL=https://router.requesty.ai` routing to
  `deepinfra/deepseek-ai/DeepSeek-V4-Pro` — all traffic stays on US infrastructure.
- **DeepInfra privacy posture**: No prompt logging, no training on customer data, no
  selling data. Temporary debug-only retention. [Source: deepinfra.com/privacy,
  deepinfra.com/terms]
- **Cost delta**: DeepInfra markup over direct DeepSeek is modest; per-quest
  difference is cents. Not worth the complexity or mistake risk of a two-tier split.

## Files Affected

| File | Change |
|---|---|
| `~/.config/systemd/user/franklin.service` | Point `EnvironmentFile` at new env file; add `ANTHROPIC_AUTH_TOKEN` via Requesty secret |
| `~/.zshrc` | Update `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, tier/agent model vars; switch auth token source |
| `~/workspace/envs/claude-requesty` | New file — env vars for the systemd unit (sibling of `claude-deepseek`) |
| `~/workspace/secrets/requesty_api_key.txt` | Already exists — contains Requesty API key |
| `playbooks/deepseek-balance.md` | Mark deprecated or repurpose for Requesty usage tracking |
| `server.ts` `/api/deepseek-balance` | Endpoint breaks (calls `api.deepseek.com` with DeepSeek key). Remove or gate behind feature flag. |

## New Environment Variables

```
ANTHROPIC_BASE_URL=https://router.requesty.ai
ANTHROPIC_AUTH_TOKEN=<requesty_api_key>
ANTHROPIC_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Pro
ANTHROPIC_DEFAULT_OPUS_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Pro
ANTHROPIC_DEFAULT_SONNET_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Pro
ANTHROPIC_DEFAULT_HAIKU_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Flash
CLAUDE_CODE_SUBAGENT_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Flash
CLAUDE_CODE_EFFORT_LEVEL=max
```

Remove: `DEEPSEEK_API_KEY` (no longer needed by Franklin; keep in secrets dir for
manual use).

## Migration Steps

### 1. Verify Requesty API key works

```bash
ANTHROPIC_BASE_URL="https://router.requesty.ai" \
ANTHROPIC_AUTH_TOKEN="$(cat ~/workspace/secrets/requesty_api_key.txt)" \
ANTHROPIC_MODEL="deepinfra/deepseek-ai/DeepSeek-V4-Pro" \
claude -p "Hello, confirm you can read this and tell me what model you are."
```

### 2. Create new environment file

Write `~/workspace/envs/claude-requesty` with the vars listed above.

### 3. Update systemd unit

```ini
# franklin.service — change EnvironmentFile and auth token source
EnvironmentFile=/home/mjscully/workspace/envs/claude-requesty
# Remove the ExecStartPre that reads deepseek_api_key.txt
# Auth token is set via EnvironmentFile now
ExecStart=/usr/bin/npm run franklin
```

### 4. Update shell config (~/.zshrc)

Replace all `ANTHROPIC_*` and `DEEPSEEK_API_KEY` lines with:

```bash
export ANTHROPIC_BASE_URL=https://router.requesty.ai
export ANTHROPIC_AUTH_TOKEN="$(tr -d '\n' < /home/mjscully/workspace/secrets/requesty_api_key.txt)"
export ANTHROPIC_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepinfra/deepseek-ai/DeepSeek-V4-Flash
```

### 5. Replace DeepSeek balance endpoint with Requesty usage endpoint

Remove `/api/deepseek-balance` and its dashboard widget. Build
`/api/requesty-usage` as a replacement. Requesty has a full usage API (see
Observability section below) — significantly richer than DeepSeek's balance
check.

### 6. Restart Franklin

```bash
systemctl --user daemon-reload
systemctl --user restart franklin.service
systemctl --user status franklin.service
```

### 7. Smoke test

Send Franklin a simple quest via Discord DM and verify it completes.

## Rollback

Point `EnvironmentFile` back to `claude-deepseek`, restore `ANTHROPIC_AUTH_TOKEN`
from `deepseek_api_key.txt`, restart. The old env file is preserved, not deleted.

## Requesty Privacy Hardening (Post-Migration)

After migration, log into the Requesty dashboard and:
1. Set prompt logging to **metadata-only** (token counts, latency — not content)
2. Enable **PII redaction** if available
3. Confirm EU routing if that's preferred over US

This ensures Requesty sees only usage metrics, not conversation content.

## Fast Follow: Requesty Usage API Integration

Once the migration is stable, add a `/api/requesty-usage` endpoint to replace the
old `/api/deepseek-balance`. Requesty has a Management API that returns per-key usage.

**Endpoint**: `GET https://api-v2.requesty.ai/v1/manage/apikey/{id}/usage`
**Auth**: Bearer token (Requesty API key)

Request:
```json
{
  "start": "2026-06-01T00:00:00Z",
  "end": "2026-06-02T23:59:59Z",
  "group_by": ["model_requested"],
  "resolution": "day"
}
```

Response shape:
```json
{
  "usage": {
    "2026-06-01": {
      "completions_requests": 1523,
      "spend": 12.45,
      "input_tokens": 890000,
      "output_tokens": 42000,
      "total_tokens": 932000
    }
  }
}
```

Constraints: 100-day max range. Group by `user_id`, `model_requested`, or custom
`extra.<field>`.

Implementation:
1. Add `REQUESTY_API_KEY` to `state/settings.json` (or read from existing secret file)
2. Build `GET /api/requesty-usage?days=7` in `server.ts`
3. Add a cost widget to the dashboard (reuse the DeepSeek balance widget layout)
4. Update or replace `playbooks/deepseek-balance.md` → `playbooks/requesty-costs.md`

This is cheap to do and means Franklin can alert on cost anomalies without relying
on the Claude Code JSON output parsing (which is a separate proposal — that parses
per-session `total_cost_usd` from worker logs, provider-agnostic).

## Requesty Observability (Dashboard)

Requesty's dashboard provides real-time analytics: cost over time, token usage,
latency (avg/P50/P90), cache hit rates, and cost savings. Custom metadata tagging
available for per-user or per-feature attribution. CSV/PDF export. Spend limits
with alerts.

## What We Lose

- **Direct DeepSeek pricing**: DeepInfra adds a margin. Estimate 1.5–3× the direct
  DeepSeek price. For Franklin's typical quest volume, this is cents per quest.
  Offset somewhat by Requesty's auto-caching (25-40% savings on cacheable requests).
- **One less company in the loop**: Direct DeepSeek is 1 company. Requesty + DeepInfra
  is 2. But both are US-jurisdiction, which is the point.
- **DEEPSEEK_API_KEY env var**: No longer needed in Franklin's runtime. Keep the
  key file for manual/one-off use.
