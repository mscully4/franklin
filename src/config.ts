/**
 * Shared constants and helpers used across Franklin modules.
 */

import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import log from "./logger.js";

// Re-export schemas and types from the canonical source
export {
  DelegationTaskSchema,
  WorkerResultSchema,
  ScheduledTaskSchema,
  SettingsSchema,
  DelegationSchema,
} from "./schemas.js";

export type {
  DelegationTask,
  WorkerResult,
  ScheduledTask,
  Settings,
  Delegation,
} from "./schemas.js";

/** Scout polling intervals in milliseconds. Single source of truth. */
export const SCOUT_INTERVALS_MS: Record<string, number> = {
  gmail: 15 * 60 * 1000,
  calendar: 10 * 60 * 1000,
};

/** Default task timeouts by type. Brain can override with `timeout` on any task. */
export const DEFAULT_TIMEOUT_BY_TYPE: Record<string, number> = {
  dm_reply:        10 * 60_000,  // 10 min
  email_notify:     5 * 60_000,  //  5 min
  quest:           60 * 60_000,  // 60 min
  scheduled:       10 * 60_000,  // 10 min
};

const DEFAULT_TASK_TIMEOUT_MS = 10 * 60_000; // fallback for unknown types

/** Resolve effective timeout for a task. */
export function resolveTaskTimeout(task: { type: string; timeout?: number }): number {
  return task.timeout ?? DEFAULT_TIMEOUT_BY_TYPE[task.type] ?? DEFAULT_TASK_TIMEOUT_MS;
}

// ── Shared interfaces (Phase 2 — not yet schema-ified) ──────────────────────

export interface DispatchLogEntry {
  task_id: string;
  type: string;
  priority: string;
  dedup_key?: string;
  dispatched_at: string;
  completed_at: string;
  status: "ok" | "error" | "skipped" | "timeout" | "no_worker" | "needs_info";
  summary: string | null;
  cost_usd?: number | null;
  quest_id?: string | null;
}

// ── Provider resolution ───────────────────────────────────────────────────────

interface QuotaCache {
  five_hour: number;
  seven_day: number;
  fetched_at: number;
}

let _quotaCache: QuotaCache | null = null;

export function getCachedQuota(): { five_hour: number; seven_day: number } {
  return { five_hour: _quotaCache?.five_hour ?? 0, seven_day: _quotaCache?.seven_day ?? 0 };
}

export async function refreshQuotaCache(): Promise<void> {
  try {
    const credsRaw = readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8");
    const token = (JSON.parse(credsRaw) as { claudeAiOauth?: { accessToken?: string } })?.claudeAiOauth?.accessToken;
    if (!token) return;

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.172",
      },
    });
    if (!res.ok) return;

    const data = await res.json() as {
      five_hour?: { utilization: number } | null;
      seven_day?: { utilization: number } | null;
    };
    _quotaCache = {
      five_hour: data.five_hour?.utilization ?? 0,
      seven_day: data.seven_day?.utilization ?? 0,
      fetched_at: Date.now(),
    };
    log.debug(`Quota: 5h=${_quotaCache.five_hour}% 7d=${_quotaCache.seven_day}%`);
  } catch {
    // leave cache as-is on failure
  }
}

export function resolveProvider(
  task: { type: string; provider?: string },
  settings: { provider_strategy?: Array<{ provider: string; fallback_when?: { quota_5h_gte?: number; quota_7d_gte?: number } }>; default_provider?: string },
): string {
  // Task-level override beats everything
  if (task.provider) return task.provider;

  const strategy = settings.provider_strategy;
  if (!strategy?.length) return settings.default_provider ?? "claude";

  const { five_hour, seven_day } = getCachedQuota();

  for (let i = 0; i < strategy.length; i++) {
    const entry = strategy[i];
    const { fallback_when } = entry;

    // No conditions — this is the terminal fallback
    if (!fallback_when) return entry.provider;

    const over5h = fallback_when.quota_5h_gte !== undefined && five_hour >= fallback_when.quota_5h_gte;
    const over7d = fallback_when.quota_7d_gte !== undefined && seven_day >= fallback_when.quota_7d_gte;

    if (!over5h && !over7d) return entry.provider;

    // Threshold exceeded — try next in chain
    const next = strategy[i + 1];
    if (next) {
      log.info(`Provider ${entry.provider} quota exceeded (5h=${five_hour}% 7d=${seven_day}%) — falling back to ${next.provider}`);
    }
  }

  // Exhausted strategy — use last entry
  return strategy[strategy.length - 1].provider;
}

/**
 * Build a clean env for spawning a provider process.
 * Clears all env keys owned by any provider before applying the selected one,
 * so keys from a previous provider (or a stale .env) never bleed through.
 */
export function buildProviderEnv(
  providerName: string,
  settings: { providers?: Record<string, { bin?: string; base_url?: string; env?: Record<string, string> }>; claude_bin?: string },
  baseEnv: NodeJS.ProcessEnv = process.env,
): { env: NodeJS.ProcessEnv; bin: string } {
  const providerConfig = settings?.providers?.[providerName];

  const env: NodeJS.ProcessEnv = { ...baseEnv };

  // Clear ANTHROPIC_BASE_URL unless this provider sets a custom one, so a
  // stale base URL from the system env never bleeds through to a default provider.
  if (!providerConfig?.base_url) delete env.ANTHROPIC_BASE_URL;
  else env.ANTHROPIC_BASE_URL = providerConfig.base_url;

  // Apply this provider's env vars, expanding $VAR references against baseEnv.
  for (const [key, val] of Object.entries(providerConfig?.env ?? {})) {
    env[key] = val.startsWith("$") ? (baseEnv[val.slice(1)] ?? "") : val;
  }

  const bin = providerConfig?.bin ?? settings?.claude_bin ?? "claude";
  return { env, bin };
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

/** Write data as pretty-printed JSON. */
export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/** Read and parse a JSON file, returning null on any error. */
export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Read a JSON file and validate it against a Zod schema.
 * Returns the validated data, or null on file-read error or validation failure.
 * Validation errors are logged at warn level with field-level detail.
 */
export function readJsonWithSchema<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
): z.infer<T> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i: z.ZodIssue) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    log.warn(`Validation failed for ${path}:\n${issues}`);
    return null;
  }
  return result.data;
}
