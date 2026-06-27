#!/usr/bin/env npx tsx
/**
 * Franklin Doctor — Diagnostics and configuration verification.
 *
 * Run anytime, with or without Franklin running. Checks settings, integrations,
 * database, process state, and system health.
 *
 * Usage:
 *   npx tsx src/doctor.ts           Terminal output
 *   npx tsx src/doctor.ts --json    Machine-readable JSON
 */

import { existsSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import { SettingsSchema } from "./schemas.js";

// ── Load .env into process.env ────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadEnvFile(ENV_FILE);

// ── Paths ────────────────────────────────────────────────────────────────────

const STATE = join(ROOT, "state");
const SETTINGS_FILE = join(STATE, "settings.json");
const LOCK_FILE = join(STATE, "franklin.lock");
const DB_FILE = join(STATE, "franklin.db");
const DISCORD_STATUS_FILE = join(STATE, "discord_bot.json");
const SCHEDULED_TASKS_FILE = join(STATE, "scheduled_tasks.json");
const EVENT_HANDLERS_FILE = join(STATE, "event_handlers.json");

const LOCK_STALE_MS = 3 * 60 * 1000; // matches lock.ts

// ── Types ────────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error" | "skip";
  message: string;
}

interface CategoryResult {
  slug: string;
  label: string;
  checks: CheckResult[];
}

type IntegrationEntry = string | { name: string; bin?: string; description?: string; env?: string[]; skillLocation?: string; healthCheck?: { command: string; expect?: string; notExpect?: string } };

interface SettingsLike {
  integrations?: IntegrationEntry[];
}

interface LockFileLike {
  pid: number;
  started_at: string;
  last_heartbeat: string;
}

// ── Result helpers ───────────────────────────────────────────────────────────

function ok(name: string, message: string): CheckResult {
  return { name, status: "ok", message };
}

function warn(name: string, message: string): CheckResult {
  return { name, status: "warn", message };
}

function err(name: string, message: string): CheckResult {
  return { name, status: "error", message };
}

function skip(name: string, message: string): CheckResult {
  return { name, status: "skip", message };
}

function worstStatus(checks: CheckResult[]): CheckResult["status"] {
  if (checks.some((c) => c.status === "error")) return "error";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.some((c) => c.status === "ok")) return "ok";
  return "skip";
}

function readJsonFile(path: string): { data: unknown } | { error: string } {
  try {
    return { data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ── Category 1: Settings ─────────────────────────────────────────────────────

function checkSettings(): { result: CategoryResult; settings: SettingsLike | null } {
  const checks: CheckResult[] = [];

  // File exists
  if (!existsSync(SETTINGS_FILE)) {
    checks.push(err("settings.json", "File not found at state/settings.json"));
    return { result: { slug: "settings", label: "Settings", checks }, settings: null };
  }
  checks.push(ok("settings.json", "File found"));

  // Valid JSON
  const parsed = readJsonFile(SETTINGS_FILE);
  if ("error" in parsed) {
    checks.push(err("Valid JSON", `Parse error: ${parsed.error}`));
    return { result: { slug: "settings", label: "Settings", checks }, settings: null };
  }
  checks.push(ok("Valid JSON", "File is valid JSON"));

  // Schema validation
  const result = SettingsSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    checks.push(err("Schema", `Validation failed:\n${issues}`));
    // Still return parsed data for integrations check to use what it can
    return { result: { slug: "settings", label: "Settings", checks }, settings: parsed.data as SettingsLike };
  }
  checks.push(ok("Schema", `Valid — ${Object.keys(result.data).length} top-level fields`));

  return { result: { slug: "settings", label: "Settings", checks }, settings: result.data };
}

// ── Category 2: Integrations ─────────────────────────────────────────────────

function resolveIntegrationName(entry: IntegrationEntry): string {
  return typeof entry === "string" ? entry : entry.name;
}

function checkIntegrations(settings: SettingsLike | null): CategoryResult {
  const checks: CheckResult[] = [];
  const integrations = settings?.integrations;

  if (!integrations?.length) {
    checks.push(skip("No integrations", "No integrations configured in settings.json"));
    return { slug: "integrations", label: "Integrations", checks };
  }

  for (const entry of integrations) {
    const name = resolveIntegrationName(entry);
    if (name === "discord") continue; // transport, not a CLI

    // Check CLI binary (only if bin is defined or entry is a string)
    const bin = typeof entry === "string" ? entry : entry.bin;
    let cliOk = false;
    if (bin) {
      try {
        execSync(`which ${bin}`, { stdio: "ignore", timeout: 5_000 });
        checks.push(ok(`${name} CLI`, `Found on $PATH`));
        cliOk = true;
      } catch {
        checks.push(err(`${name} CLI`, "Not found on $PATH"));
      }
    }

    // Check env vars (warn/error independently of CLI presence)
    if (typeof entry !== "string" && entry.env) {
      for (const v of entry.env) {
        if (process.env[v]) {
          checks.push(ok(`${name}: ${v}`, "Set"));
        } else {
          checks.push(warn(`${name}: ${v}`, "Not set"));
        }
      }
    }

    // Check skill path
    if (typeof entry !== "string" && entry.skillLocation) {
      const loc = entry.skillLocation;
      if (/^https?:\/\//.test(loc)) {
        checks.push(skip(`${name} skill`, `URL — ${loc}`));
      } else {
        const skillDir = join(ROOT, loc);
        if (existsSync(skillDir)) {
          const hasSkillMd = existsSync(join(skillDir, "SKILL.md"));
          checks.push(hasSkillMd
            ? ok(`${name} skill`, `${loc}/SKILL.md exists`)
            : warn(`${name} skill`, `${loc} exists but no SKILL.md`));
        } else {
          checks.push(err(`${name} skill`, `${loc} not found`));
        }
      }
    }

    // Health check
    if (typeof entry !== "string" && entry.healthCheck) {
      const hc = entry.healthCheck;
      try {
        const out = execSync(`set -a; source "${ENV_FILE}"; set +a; ${hc.command}`, { encoding: "utf8", timeout: 10_000, shell: "/bin/bash" });
        const combined = out.trim();

        const failures: string[] = [];

        if (hc.expect) {
          try {
            if (!new RegExp(hc.expect).test(combined)) {
              failures.push(`expected /${hc.expect}/ not found in output`);
            }
          } catch (e) {
            failures.push(`invalid expect regex: ${hc.expect}`);
          }
        }

        if (hc.notExpect) {
          try {
            if (new RegExp(hc.notExpect).test(combined)) {
              failures.push(`notExpect /${hc.notExpect}/ matched in output`);
            }
          } catch (e) {
            failures.push(`invalid notExpect regex: ${hc.notExpect}`);
          }
        }

        if (failures.length > 0) {
          checks.push(err(`${name} health`, failures.join("; ")));
        } else {
          checks.push(ok(`${name} health`, "Passed"));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        checks.push(err(`${name} health`, `Command failed — ${msg}`));
      }
    }
  }

  return { slug: "integrations", label: "Integrations", checks };
}

// ── Category 3: Database ─────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  "surfaced", "dispatch_log", "quests", "inflight_prs", "deploys",
  "channel_policies", "channel_user_rules", "running_tasks", "counters",
];

function checkDatabase(): CategoryResult {
  const checks: CheckResult[] = [];

  if (!existsSync(DB_FILE)) {
    checks.push(err("Database file", "franklin.db not found"));
    return { slug: "database", label: "Database", checks };
  }
  checks.push(ok("Database file", "franklin.db exists"));

  // Try to open
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_FILE, { readonly: true });
    checks.push(ok("Open database", "Opened successfully"));
  } catch (e) {
    checks.push(err("Open database", `Cannot open: ${(e as Error).message}`));
    return { slug: "database", label: "Database", checks };
  }

  try {
    // Check tables
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
    ).map((r) => r.name);
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      checks.push(err("Tables", `Missing: ${missing.join(", ")}`));
    } else {
      checks.push(ok("Tables", `All ${tables.length} expected tables present`));
    }

    // Row counts
    for (const table of ["dispatch_log", "quests", "running_tasks", "surfaced"]) {
      if (tables.includes(table)) {
        const count = (db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt;
        checks.push(ok(`  ${table}`, `${count} row${count === 1 ? "" : "s"}`));
      }
    }
  } finally {
    db.close();
  }

  // WAL file size
  const walPath = DB_FILE + "-wal";
  if (existsSync(walPath)) {
    try {
      const dbSize = statSync(DB_FILE).size;
      const walSize = statSync(walPath).size;
      const ratio = walSize / (dbSize || 1);
      if (ratio > 10 || walSize > 100 * 1024 * 1024) {
        checks.push(warn(
          "WAL file",
          `WAL is ${(walSize / 1024 / 1024).toFixed(1)} MB vs DB ${(dbSize / 1024).toFixed(0)} KB — consider checkpoint`,
        ));
      } else {
        checks.push(ok("WAL file", `${(walSize / 1024).toFixed(0)} KB (normal)`));
      }
    } catch {
      checks.push(skip("WAL file", "Could not stat"));
    }
  }

  return { slug: "database", label: "Database", checks };
}

// ── Category 4: Process / Lock ───────────────────────────────────────────────

function checkProcessLock(): CategoryResult {
  const checks: CheckResult[] = [];

  if (!existsSync(LOCK_FILE)) {
    checks.push(skip("Lock file", "Not found — Franklin is not running"));
    return { slug: "process", label: "Process", checks };
  }
  checks.push(ok("Lock file", "Found"));

  const parsed = readJsonFile(LOCK_FILE);
  if ("error" in parsed) {
    checks.push(warn("Lock content", `Invalid JSON: ${parsed.error}`));
    return { slug: "process", label: "Process", checks };
  }

  const lock = parsed.data as LockFileLike;
  if (typeof lock.pid !== "number" || typeof lock.last_heartbeat !== "string") {
    checks.push(warn("Lock content", "Missing pid or last_heartbeat"));
    return { slug: "process", label: "Process", checks };
  }

  // PID check
  try {
    process.kill(lock.pid, 0);
    checks.push(ok("PID", `${lock.pid} is alive`));
  } catch (e: any) {
    if (e?.code === "EPERM") {
      checks.push(warn("PID", `${lock.pid} exists but owned by another user`));
    } else {
      checks.push(err("PID", `${lock.pid} is dead — stale lock`));
      return { slug: "process", label: "Process", checks };
    }
  }

  // Heartbeat freshness
  const ageMs = Date.now() - new Date(lock.last_heartbeat).getTime();
  const ageSec = Math.round(ageMs / 1000);
  if (ageMs >= LOCK_STALE_MS) {
    checks.push(warn("Heartbeat", `${ageSec}s old — exceeds ${LOCK_STALE_MS / 1000}s stale threshold`));
  } else {
    checks.push(ok("Heartbeat", `${ageSec}s old (within limit)`));
  }

  // Uptime
  if (lock.started_at) {
    const uptimeMin = Math.round((Date.now() - new Date(lock.started_at).getTime()) / 60000);
    checks.push(ok("Uptime", `${uptimeMin} min since ${lock.started_at}`));
  }

  return { slug: "process", label: "Process", checks };
}

// ── Category 5: State Files ──────────────────────────────────────────────────

function checkStateFiles(): CategoryResult {
  const checks: CheckResult[] = [];

  for (const [label, path] of [
    ["scheduled_tasks.json", SCHEDULED_TASKS_FILE],
    ["event_handlers.json", EVENT_HANDLERS_FILE],
  ] as const) {
    if (!existsSync(path)) {
      checks.push(skip(label, "File not found"));
      continue;
    }
    const parsed = readJsonFile(path);
    if ("error" in parsed) {
      checks.push(warn(label, `Invalid JSON: ${parsed.error}`));
    } else {
      checks.push(ok(label, "Valid JSON"));
    }
  }

  return { slug: "state_files", label: "State Files", checks };
}

// ── Category 6: Directories ──────────────────────────────────────────────────

const REQUIRED_DIRS = [
  ["state/", STATE],
  ["state/quests/", join(STATE, "quests")],
  ["state/logs/", join(STATE, "logs")],
  ["prompts/", join(ROOT, "prompts")],
];

function checkDirectories(): CategoryResult {
  const checks: CheckResult[] = [];
  for (const [label, path] of REQUIRED_DIRS) {
    if (existsSync(path)) {
      checks.push(ok(label, "Exists"));
    } else {
      checks.push(err(label, "Missing"));
    }
  }
  return { slug: "directories", label: "Directories", checks };
}

// ── Category 7: Discord ──────────────────────────────────────────────────────

function checkDiscord(): CategoryResult {
  const checks: CheckResult[] = [];

  // Token (env var, always checkable)
  if (process.env.DISCORD_BOT_TOKEN) {
    checks.push(ok("Bot token", "DISCORD_BOT_TOKEN is set"));
  } else {
    checks.push(err("Bot token", "DISCORD_BOT_TOKEN not set — check .env file"));
  }

  if (!existsSync(DISCORD_STATUS_FILE)) {
    checks.push(skip("Bot status file", "Not found — server may not be running"));
    return { slug: "discord", label: "Discord", checks };
  }
  checks.push(ok("Bot status file", "Found"));

  const parsed = readJsonFile(DISCORD_STATUS_FILE);
  if ("error" in parsed) {
    checks.push(warn("Content", `Invalid JSON: ${parsed.error}`));
    return { slug: "discord", label: "Discord", checks };
  }

  const status = parsed.data as { status?: string; updated_at?: string };

  if (status.status === "connected") {
    checks.push(ok("Connection", "Connected"));
  } else if (status.status) {
    checks.push(err("Connection", `Status: ${status.status}`));
  } else {
    checks.push(warn("Connection", "No status field"));
  }

  if (status.updated_at) {
    const ageSec = Math.round((Date.now() - new Date(status.updated_at).getTime()) / 1000);
    if (ageSec > 300) {
      checks.push(warn("Freshness", `Last update ${ageSec}s ago (stale)`));
    } else {
      checks.push(ok("Freshness", `Updated ${ageSec}s ago`));
    }
  } else {
    checks.push(warn("Freshness", "No updated_at timestamp"));
  }

  return { slug: "discord", label: "Discord", checks };
}

// ── Category 8: System ───────────────────────────────────────────────────────

function checkSystem(): CategoryResult {
  const checks: CheckResult[] = [];

  // Node version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace(/^v/, "").split(".")[0], 10);
  if (major >= 18) {
    checks.push(ok("Node.js", nodeVer));
  } else {
    checks.push(warn("Node.js", `${nodeVer} — recommend v18+`));
  }

  // Disk space on state partition
  try {
    const out = execSync(`df -k "${STATE}"`, { encoding: "utf8", timeout: 5_000 });
    const lines = out.trim().split("\n");
    if (lines.length >= 2) {
      const cols = lines[1].split(/\s+/);
      const total = parseInt(cols[1], 10); // 1K blocks
      const used = parseInt(cols[2], 10);
      const avail = parseInt(cols[3], 10);
      const pctUsed = Math.round((used / total) * 100);
      const availGB = (avail / 1024 / 1024).toFixed(1);

      if (pctUsed > 90) {
        checks.push(warn("Disk space", `${availGB} GB free (${pctUsed}% used — nearly full)`));
      } else {
        checks.push(ok("Disk space", `${availGB} GB free (${pctUsed}% used)`));
      }
    } else {
      checks.push(skip("Disk space", "Could not parse df output"));
    }
  } catch {
    checks.push(skip("Disk space", "df command failed"));
  }

  return { slug: "system", label: "System", checks };
}

// ── Render: Terminal ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<CheckResult["status"], string> = {
  ok: "✅",
  warn: "⚠️",
  error: "❌",
  skip: "⬜",
};

function renderTerminal(categories: CategoryResult[], elapsed: number): void {
  const ts = new Date().toISOString();
  console.log(`\n🦝  Franklin Doctor — ${ts}`);
  console.log("═".repeat(60));

  for (const cat of categories) {
    console.log(`\n  ${cat.label}`);
    console.log("  " + "─".repeat(50));
    for (const c of cat.checks) {
      const icon = STATUS_ICON[c.status];
      const lines = c.message.split("\n");
      console.log(`  ${icon}  ${c.name}`);
      for (const line of lines) {
        console.log(`      ${line}`);
      }
    }
  }

  // Summary
  const allChecks = categories.flatMap((c) => c.checks);
  const counts = { ok: 0, warn: 0, error: 0, skip: 0 };
  for (const c of allChecks) {
    counts[c.status]++;
  }

  console.log("\n" + "═".repeat(60));
  const parts = [];
  if (counts.ok) parts.push(`✅ ${counts.ok} ok`);
  if (counts.warn) parts.push(`⚠️  ${counts.warn} warn`);
  if (counts.error) parts.push(`❌ ${counts.error} error`);
  if (counts.skip) parts.push(`⬜ ${counts.skip} skipped`);
  const statusLine = parts.join("  ");

  if (counts.error > 0) {
    console.log(`  ${statusLine}  |  ❌  Fix errors above`);
  } else if (counts.warn > 0) {
    console.log(`  ${statusLine}  |  ⚠️  Review warnings above`);
  } else {
    console.log(`  ${statusLine}  |  ✅  All good`);
  }
  console.log(`  Completed in ${elapsed}ms\n`);
}

// ── Render: JSON ─────────────────────────────────────────────────────────────

function renderJson(categories: CategoryResult[], elapsed: number): void {
  const cats: Record<string, unknown> = {};
  for (const cat of categories) {
    cats[cat.slug] = {
      status: worstStatus(cat.checks),
      checks: cat.checks,
    };
  }
  const allChecks = categories.flatMap((c) => c.checks);
  const counts = { ok: 0, warn: 0, error: 0, skip: 0 };
  for (const c of allChecks) {
    counts[c.status]++;
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    elapsed_ms: elapsed,
    categories: cats,
    summary: {
      total: allChecks.length,
      ...counts,
    },
  }, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");

  const started = Date.now();

  const { result: settingsResult, settings } = checkSettings();
  const categories: CategoryResult[] = [
    settingsResult,
    checkIntegrations(settings),
    checkDatabase(),
    checkProcessLock(),
    checkStateFiles(),
    checkDirectories(),
    checkDiscord(),
    checkSystem(),
  ];

  const elapsed = Date.now() - started;

  if (jsonMode) {
    renderJson(categories, elapsed);
  } else {
    renderTerminal(categories, elapsed);
  }

  const hasErrors = categories.some((c) => c.checks.some((ch) => ch.status === "error"));
  process.exit(hasErrors ? 1 : 0);
}

main();
