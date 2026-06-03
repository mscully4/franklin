# Cost Tracking from Worker Logs

Parse `total_cost_usd` and `modelUsage` from Claude Code's JSON output in
`state/logs/workers/<task_id>.json`. Provider-agnostic — works with any model
backend. No external API needed.

## Motivation

Claude Code's `--output-format json` already returns per-session cost data:

```json
{
  "total_cost_usd": 0.12706,
  "modelUsage": {
    "deepseek-v4-pro[1m]": {
      "inputTokens": 24833,
      "outputTokens": 14,
      "cacheReadInputTokens": 0,
      "cacheCreationInputTokens": 0,
      "costUSD": 0.124515,
      "contextWindow": 1000000
    },
    "deepseek-v4-flash": {
      "inputTokens": 354,
      "outputTokens": 31,
      "costUSD": 0.002545,
      "contextWindow": 200000
    }
  },
  "usage": {
    "input_tokens": 24833,
    "output_tokens": 14,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0
  }
}
```

Franklin already writes this to `state/logs/workers/<task_id>.json` in
`task-manager.ts` (line 234-235). It's just never parsed for cost data.

## What This Enables

| Feature | Source field |
|---|---|
| Per-task cost | `total_cost_usd` |
| Per-model breakdown | `modelUsage.<model>.costUSD` |
| Cache effectiveness | `usage.cache_read_input_tokens` |
| Cost efficiency ratio | output_tokens / cost |
| Task type cost comparison | group by `task.type` in DB |

## Implementation

### Phase 1 — Extract and store

Patch `task-manager.ts` to parse the JSON from stdout (not just pipe to log) and
extract cost fields. Store in the tasks database alongside the existing task record.

Schema addition to the `tasks` or `task_runs` table:
```
cost_usd REAL
input_tokens INTEGER
output_tokens INTEGER
cache_read_input_tokens INTEGER
cache_creation_input_tokens INTEGER
model_breakdown TEXT  -- JSON blob of modelUsage
```

### Phase 2 — Dashboard widget

A cost widget replacing the DeepSeek balance widget:
- Today's spend
- This month's spend
- Cost per task type (quest, cron, manual)
- Chart: daily spend over last 30 days

API: `GET /api/cost-summary?days=30` → aggregate from DB.

### Phase 3 — Playbook

`playbooks/cost-monitor.md` — weekly cron:
- Check week-over-week spend delta
- Flag tasks with unusually high cost
- DM if spend is accelerating

## Files Affected

| File | Change |
|---|---|
| `src/supervisor/task-manager.ts` | Parse JSON stdout, extract cost fields, write to DB |
| `src/db/tasks.ts` | Add cost columns to task table |
| `server.ts` | Add `/api/cost-summary` endpoint |
| `index.html` | Add cost widget to dashboard |
| `playbooks/cost-monitor.md` | New — weekly cost review playbook |

## Non-Goals

- Real-time cost streaming (JSON is only available on session completion)
- Per-request cost (we get per-session, which may contain multiple turns)
- Provider-specific billing (use Requesty API for that)
