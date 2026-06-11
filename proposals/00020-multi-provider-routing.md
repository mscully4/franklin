# Multi-Provider Routing

Register multiple AI providers in `settings.json` and route tasks to the right
one automatically — by task type, or with a per-task override.

## Motivation

Franklin runs on a Claude Pro subscription (flat-rate quota) but can also reach
cheaper/faster providers (DeepSeek, Bedrock, local Ollama) via
`ANTHROPIC_BASE_URL`. Low-stakes tasks (DM replies, email notifications) don't
need Claude's full capability and burn quota unnecessarily. High-stakes tasks
(quests, code work) should always use Claude.

The goal is a single routing config that the task manager resolves at dispatch
time — no per-task wiring required.

## Design

### Provider registry (`state/settings.json`)

```json
"providers": {
  "claude": {
    "bin": "claude"
  },
  "deepseek": {
    "bin": "claude",
    "base_url": "https://api.deepseek.com",
    "env": {
      "ANTHROPIC_API_KEY": "$DEEPSEEK_API_KEY"
    }
  }
},
"default_provider": "claude"
```

Each provider entry specifies:
- `bin` — path to the Claude Code CLI binary (can be shared across providers)
- `base_url` — static value set as `ANTHROPIC_BASE_URL` at spawn time
- `env` — env var mapping for spawn time. Keys are the env var names Claude Code expects; values are either a `$`-prefixed env var name to read from the process environment, or a literal static value (no `$`)

Since Claude Code supports `ANTHROPIC_BASE_URL`, providers like DeepSeek,
Bedrock, or local Ollama don't need a separate binary.

### Type-level routing

```json
"model_routing": {
  "dm_reply": "deepseek",
  "email_notify": "deepseek",
  "scheduled": "deepseek"
}
```

Applies to all tasks of that type unless overridden at the task level.

### Per-task override (scheduled tasks)

```json
{
  "id": "weekly-financial-summary",
  "type": "scheduled",
  "provider": "claude"
}
```

Explicit `provider` field on a scheduled task beats type-level routing.

### Quota-aware fallback

When the resolved provider is `claude`, Franklin checks the live Claude Pro
subscription utilization before spawning. If utilization exceeds a configured
threshold, the task is rerouted to a fallback provider automatically.

```json
"quota_threshold": 75,
"quota_fallback": "deepseek"
```

- `quota_threshold` — 5-hour utilization percentage at which fallback kicks in (default 75)
- `quota_fallback` — provider name to use when threshold is exceeded

The utilization is fetched from `GET https://api.anthropic.com/api/oauth/usage`
(requires `anthropic-beta: oauth-2025-04-20`), authenticated with the OAuth token
Claude Code stores at `~/.claude/.credentials.json`. The response shape:

```json
{
  "five_hour": { "utilization": 12.0, "resets_at": "..." },
  "seven_day": { "utilization": 9.0, "resets_at": "..." }
}
```

`utilization` is a percentage (0–100). Franklin uses the `five_hour` window as the
routing signal — it resets every 5 hours, so pressure is transient.

The quota is fetched once per supervisor cycle and cached in memory (fire-and-forget,
non-blocking). `resolveProvider` reads the cache synchronously. On the first cycle the
cache is empty and the threshold check is skipped (safe default — Claude is used).

### Resolution order (highest → lowest priority)

1. Task-level `provider` field
2. `model_routing[task.type]`
3. Quota check: if resolved provider is `claude` and `five_hour.utilization >= quota_threshold` → use `quota_fallback`
4. `default_provider`

### Spawn-time env merge

In `task-manager.ts`, when spawning a worker:

```typescript
const providerName = resolveProvider(task);
const provider = settings.providers?.[providerName];
const spawnEnv = { ...process.env };
if (provider?.base_url) spawnEnv.ANTHROPIC_BASE_URL = provider.base_url;
for (const [key, val] of Object.entries(provider?.env ?? {})) {
  spawnEnv[key] = val.startsWith("$") ? (process.env[val.slice(1)] ?? "") : val;
}
const bin = provider?.bin ?? settings.claude_bin;
// spawn bin with spawnEnv
```

## Files Changed

| File | Change |
|------|--------|
| `state/settings.json` | Add `providers`, `default_provider`, `model_routing`, `quota_threshold`, `quota_fallback` |
| `src/schemas.ts` | Add `ProviderEntry` schema, extend `SettingsSchema`; add `provider` field to task schemas |
| `src/config.ts` | Add `getCachedQuota()`, `refreshQuotaCache()`, `resolveProvider(task, settings)` |
| `src/supervisor/task-manager.ts` | Use provider bin + env at worker spawn |
| `src/supervisor/index.ts` | Fire `refreshQuotaCache()` once per cycle (non-blocking) |

## Trade-offs

**Pros**
- Zero per-task wiring for the common case (type routing handles it)
- Adding a new provider is one JSON block in settings, no code change
- Works with any OpenAI-compatible backend via `ANTHROPIC_BASE_URL`
- Cost tracking already captures model used — provider routing is visible in logs

**Cons**
- Secrets (API keys) live in `state/settings.json` — already the pattern for
  other keys, but worth noting
- No automatic fallback if a provider is down (could be added later)
- Brain-level dynamic routing (choosing provider based on task content) is out
  of scope; this is static routing only

## Out of Scope

- Dynamic/brain-driven routing per task content
- Provider health checks or automatic failover
- Cost-budget enforcement (e.g., stop using Claude after $X/week)
- 7-day utilization as a routing signal (5-hour window is sufficient; 7-day pressure is too slow-moving to be actionable)
