# Event Pipeline Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Franklin with a configurable event pipeline: SQS deal-dash messages → Discord embed post, and Discord reactions → SNS feedback events, using `state/event_handlers.json` as the handler registry.

**Architecture:** `server.ts` Discord gateway captures reactions and stores them in SQLite. `filter-signals.ts` drains reactions into `state/brain_input/discord_reactions.json`. Brain reads `event_handlers.json`, matches events to handlers, and dispatches `kind: "script"` or `kind: "worker"` tasks. Script tasks receive their full context via `FRANKLIN_TASK_CONTEXT` env var.

**Tech Stack:** TypeScript, discord.js v14, @aws-sdk/client-sns, @aws-sdk/client-sqs (existing), zod (existing)

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Install | `package.json` | Add `@aws-sdk/client-sns` |
| Modify | `src/schemas.ts` | Add `EventHandlerSchema`, `ReactionEventSchema` |
| Modify | `src/tests/schemas.test.ts` | Tests for new schemas |
| Modify | `franklin.ts` | Pass `FRANKLIN_TASK_CONTEXT` env var in `runScriptTask`; ack SQS for successful script tasks |
| Modify | `server.ts` | Add `GuildMessageReactions` intent + `messageReactionAdd` handler |
| Modify | `src/filter-signals.ts` | Partition reaction events → `state/brain_input/discord_reactions.json` |
| Create | `src/scripts/discord_post_deal.ts` | Post deal embed to Discord, encode metadata in footer |
| Create | `src/scripts/sns_publish_feedback.ts` | Publish 👍/👎 feedback to SNS outbox topic |
| Create | `state/event_handlers.json` | Initial handler registry |
| Modify | `modes/brain.md` | Step 6 rewrite: event_handlers.json routing; new step for discord_reactions.json |

---

## Task 1: Install SNS SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the SNS client**

```bash
npm install @aws-sdk/client-sns
```

- [ ] **Step 2: Verify it appears in package.json**

```bash
grep client-sns package.json
```

Expected: `"@aws-sdk/client-sns": "^3.xxxx.x"`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @aws-sdk/client-sns dependency"
```

---

## Task 2: Add Schemas

**Files:**
- Modify: `src/schemas.ts`
- Test: `src/tests/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/tests/schemas.test.ts`:

```ts
import {
  EventHandlerSchema,
  ReactionEventSchema,
} from "../schemas.js";

describe("EventHandlerSchema", () => {
  test("accepts script handler with command", () => {
    const data = {
      id: "deal-dash-post",
      event_type: "deal-dash",
      sub_type: null,
      kind: "script" as const,
      command: "npx tsx src/scripts/discord_post_deal.ts",
      timeout: 30000,
      description: "Post deal embed",
      context: { channel_id: "1502059393724715038" },
    };
    assert.ok(EventHandlerSchema.safeParse(data).success);
  });

  test("accepts worker handler without command", () => {
    const data = {
      id: "complex-request",
      event_type: "user-request",
      sub_type: null,
      kind: "worker" as const,
    };
    assert.ok(EventHandlerSchema.safeParse(data).success);
  });

  test("accepts handler with non-null sub_type", () => {
    const data = {
      id: "deal-reaction",
      event_type: "reaction",
      sub_type: "deal-dash",
      kind: "script" as const,
      command: "npx tsx src/scripts/sns_publish_feedback.ts",
    };
    assert.ok(EventHandlerSchema.safeParse(data).success);
  });

  test("rejects handler missing id", () => {
    const data = { event_type: "deal-dash", sub_type: null, kind: "script" as const };
    assert.ok(!EventHandlerSchema.safeParse(data).success);
  });

  test("rejects handler with invalid kind", () => {
    const data = { id: "x", event_type: "x", sub_type: null, kind: "lambda" };
    assert.ok(!EventHandlerSchema.safeParse(data).success);
  });

  test("validates array of handlers", () => {
    const arr = [
      { id: "a", event_type: "deal-dash", sub_type: null, kind: "script" as const, command: "echo hi" },
      { id: "b", event_type: "reaction", sub_type: "deal-dash", kind: "script" as const, command: "echo bye" },
    ];
    assert.ok(z.array(EventHandlerSchema).safeParse(arr).success);
  });
});

describe("ReactionEventSchema", () => {
  test("accepts valid reaction event", () => {
    const data = {
      message_id: "1234567890123456789",
      channel_id: "1502059393724715038",
      user_id: "987654321098765432",
      emoji: "👍",
      reacted_at: "2026-05-18T00:00:00.000Z",
      sub_type: "deal-dash",
      meta: { upc: "012345678901", title: "Widget Pro", retailer: "Best Buy" },
    };
    assert.ok(ReactionEventSchema.safeParse(data).success);
  });

  test("rejects reaction missing sub_type", () => {
    const data = {
      message_id: "1234567890123456789",
      channel_id: "1502059393724715038",
      user_id: "987654321098765432",
      emoji: "👍",
      reacted_at: "2026-05-18T00:00:00.000Z",
      meta: {},
    };
    assert.ok(!ReactionEventSchema.safeParse(data).success);
  });

  test("rejects reaction missing message_id", () => {
    const data = {
      channel_id: "1502059393724715038",
      user_id: "987654321098765432",
      emoji: "👍",
      reacted_at: "2026-05-18T00:00:00.000Z",
      sub_type: "deal-dash",
      meta: {},
    };
    assert.ok(!ReactionEventSchema.safeParse(data).success);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: errors about `EventHandlerSchema` and `ReactionEventSchema` not exported from `../schemas.js`

- [ ] **Step 3: Add schemas to `src/schemas.ts`**

Add to the bottom of `src/schemas.ts`:

```ts
// ── Event handlers (state/event_handlers.json) ───────────────────────────────

export const EventHandlerSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  sub_type: z.string().nullable(),
  kind: z.enum(["script", "worker"]),
  command: z.string().optional(),
  timeout: z.number().optional(),
  description: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type EventHandler = z.infer<typeof EventHandlerSchema>;

// ── Reaction events (state/brain_input/discord_reactions.json) ───────────────

export const ReactionEventSchema = z.object({
  message_id: z.string(),
  channel_id: z.string(),
  user_id: z.string(),
  emoji: z.string(),
  reacted_at: z.string(),
  sub_type: z.string(),
  meta: z.record(z.string(), z.unknown()),
});

export type ReactionEvent = z.infer<typeof ReactionEventSchema>;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts src/tests/schemas.test.ts
git commit -m "feat: add EventHandlerSchema and ReactionEventSchema"
```

---

## Task 3: Pass Context to Script Tasks + SQS Ack

Script tasks currently run with no access to their task context. This task adds `FRANKLIN_TASK_CONTEXT` env var and acks SQS for successful script tasks.

**Files:**
- Modify: `franklin.ts:405-430` (runScriptTask), `franklin.ts:436-455` (dispatchTasks)

- [ ] **Step 1: Modify `runScriptTask` to pass `FRANKLIN_TASK_CONTEXT`**

Find this line in `runScriptTask` (~line 412):
```ts
stdout = execSync(task.command, { cwd: ROOT, timeout: timeoutMs, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
```

Replace with:
```ts
stdout = execSync(task.command, {
  cwd: ROOT,
  timeout: timeoutMs,
  encoding: "utf-8",
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, FRANKLIN_TASK_CONTEXT: JSON.stringify(task.context) },
}).trim();
```

- [ ] **Step 2: Add SQS ack for successful script tasks**

In `dispatchTasks`, find this block (~line 436):
```ts
    if (task.kind === "script") {
      // Script tasks run synchronously — no LLM involved
      const result = runScriptTask(task);
      // Apply mark_surfaced inline for scripts (they complete immediately)
      if (result.status === "ok" && task.mark_surfaced) {
```

After the `mark_surfaced` block and before the `schedId` block, add:
```ts
      // Ack SQS message if this script task processed one
      const sqsId = task.context.sqs_message_id as string | undefined;
      if (result.status === "ok" && sqsId) {
        ackSqsMessages([sqsId]).catch((e: unknown) => {
          log.error(`SQS ack failed for script task ${task.id}: ${(e as Error).message}`);
        });
      }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add franklin.ts
git commit -m "feat: pass FRANKLIN_TASK_CONTEXT env var to script tasks; ack SQS on success"
```

---

## Task 4: Discord Reaction Gateway

Add reaction capture to the persistent Discord bot in `server.ts`.

**Files:**
- Modify: `server.ts` (~line 265, Client constructor)

- [ ] **Step 1: Add `GuildMessageReactions` intent to the Client**

Find the Client constructor (~line 265):
```ts
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
```

Replace with:
```ts
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  });
```

- [ ] **Step 2: Add `messageReactionAdd` handler**

Add this block after the `client.on("messageCreate", ...)` block and before `client.on("error", ...)`:

```ts
  client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return;

    // Fetch partials if needed
    const fullReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
    if (!fullReaction) return;
    const msg = fullReaction.message.partial
      ? await fullReaction.message.fetch().catch(() => null)
      : fullReaction.message;
    if (!msg) return;

    // Only handle reactions on embeds with Franklin metadata in the footer
    const footer = msg.embeds[0]?.footer?.text;
    if (!footer) return;

    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(footer);
    } catch {
      return;
    }
    if (!meta.sub_type) return;

    const emoji = fullReaction.emoji.name ?? "";
    const userId = typeof user.id === "string" ? user.id : "";
    const reactionTs = `reaction:${msg.id}:${userId}:${emoji}`;

    db.insertSlackEvent({
      event_ts: reactionTs,
      channel: msg.channelId,
      channel_type: "reaction",
      user_id: userId,
      type: "reaction",
      reaction: emoji,
      raw: {
        message_id: msg.id,
        channel_id: msg.channelId,
        user_id: userId,
        emoji,
        reacted_at: new Date().toISOString(),
        sub_type: meta.sub_type,
        meta,
      },
    });

    log.info(`[discord] reaction ${emoji} on message ${msg.id} from ${userId} (sub_type=${meta.sub_type})`);
  });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: capture Discord reactions in gateway, store in slack_inbox"
```

---

## Task 5: Drain Reactions in filter-signals.ts

Partition reaction events from message events and write them to `state/brain_input/discord_reactions.json`.

**Files:**
- Modify: `src/filter-signals.ts`

- [ ] **Step 1: Separate reaction events before the existing loop**

In `filter-signals.ts`, find this block (~line 93):
```ts
const pendingEvents = db.getPendingSlackEvents();
const handlerChannels = new Set(CHANNEL_SIGNAL_HANDLERS.map((h) => h.channel));
const inboxEvents: InboxEvent[] = [];
let channelSignalCount = 0;

for (const event of pendingEvents) {
```

Replace with:
```ts
const pendingEvents = db.getPendingSlackEvents();
const handlerChannels = new Set(CHANNEL_SIGNAL_HANDLERS.map((h) => h.channel));
const inboxEvents: InboxEvent[] = [];
let channelSignalCount = 0;

// Partition reactions out before message processing
const reactionRaws = pendingEvents
  .filter((e) => e.type === "reaction")
  .map((e) => e.raw);
const messageEvents = pendingEvents.filter((e) => e.type !== "reaction");

for (const event of messageEvents) {
```

- [ ] **Step 2: Write `discord_reactions.json` alongside the other output files**

Find this block (~line 130):
```ts
writeFileSync(join(OUT_DIR, "signals.json"), JSON.stringify(signals, null, 2));
writeFileSync(join(OUT_DIR, "slack_inbox.json"), JSON.stringify(inboxEvents, null, 2));
```

Replace with:
```ts
writeFileSync(join(OUT_DIR, "signals.json"), JSON.stringify(signals, null, 2));
writeFileSync(join(OUT_DIR, "slack_inbox.json"), JSON.stringify(inboxEvents, null, 2));
writeFileSync(join(OUT_DIR, "discord_reactions.json"), JSON.stringify(reactionRaws, null, 2));
```

- [ ] **Step 3: Update the log line to include reaction count**

Find (~line 135):
```ts
log.info(
  `${signals.length} changed signals (${channelSignalCount} from socket channels), ` +
  `${inboxEvents.length} slack inbox events → ${OUT_DIR}`
);
```

Replace with:
```ts
log.info(
  `${signals.length} changed signals (${channelSignalCount} from socket channels), ` +
  `${inboxEvents.length} inbox events, ${reactionRaws.length} reactions → ${OUT_DIR}`
);
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Smoke test**

```bash
npx tsx src/filter-signals.ts
cat state/brain_input/discord_reactions.json
```

Expected: `[]` (no reactions yet), file created successfully

- [ ] **Step 6: Commit**

```bash
git add src/filter-signals.ts
git commit -m "feat: drain Discord reaction events to brain_input/discord_reactions.json"
```

---

## Task 6: discord_post_deal.ts Script

Posts a deal embed to a Discord channel. Reads deal payload from `FRANKLIN_TASK_CONTEXT` env var. Encodes deal metadata in the embed footer so the reaction gateway can recover it.

**Files:**
- Create: `src/scripts/discord_post_deal.ts`

- [ ] **Step 1: Create the script**

```ts
#!/usr/bin/env npx tsx
/**
 * Post a deal-dash deal as a Discord embed.
 *
 * Context (FRANKLIN_TASK_CONTEXT env var):
 *   payload.upc        — product UPC
 *   payload.title      — product title
 *   payload.retailer   — retailer name
 *   payload.price      — sale price (optional)
 *   payload.url        — deal URL (optional)
 *   payload.channel_id — Discord channel to post to
 *   sqs_message_id     — for SQS acking (handled by supervisor)
 */

import { REST, Routes } from "discord.js";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createLogger } from "../logger.js";

const log = createLogger("discord_post_deal");

interface DealPayload {
  upc: string;
  title: string;
  retailer: string;
  price?: number;
  original_price?: number;
  url?: string;
  channel_id: string;
}

interface TaskContext {
  payload: DealPayload;
  sqs_message_id: string;
}

const raw = process.env.FRANKLIN_TASK_CONTEXT;
if (!raw) {
  log.error("FRANKLIN_TASK_CONTEXT not set");
  process.exit(1);
}

let ctx: TaskContext;
try {
  ctx = JSON.parse(raw) as TaskContext;
} catch {
  log.error("FRANKLIN_TASK_CONTEXT is not valid JSON");
  process.exit(1);
}

const deal = ctx.payload;
if (!deal.channel_id) {
  log.error("payload.channel_id is required");
  process.exit(1);
}

const sm = new SecretsManagerClient({ region: "us-east-2" });
const tokenResponse = await sm.send(
  new GetSecretValueCommand({ SecretId: "franklin/discord-bot-token" }),
);
if (!tokenResponse.SecretString) {
  log.error("Discord bot token secret has no value");
  process.exit(1);
}

const rest = new REST().setToken(tokenResponse.SecretString);

const fields = [
  { name: "Retailer", value: deal.retailer, inline: true },
  { name: "UPC", value: deal.upc, inline: true },
];
if (deal.price !== undefined) {
  fields.push({ name: "Price", value: `$${deal.price}`, inline: true });
}
if (deal.original_price !== undefined) {
  fields.push({ name: "Original", value: `$${deal.original_price}`, inline: true });
}

// Footer encodes metadata so the reaction gateway can recover it without a local state file
const footerMeta = JSON.stringify({
  sub_type: "deal-dash",
  upc: deal.upc,
  title: deal.title,
  retailer: deal.retailer,
});

const embed = {
  title: deal.title,
  ...(deal.url ? { url: deal.url } : {}),
  fields,
  footer: { text: footerMeta },
  color: 0x00b4d8,
};

const response = await rest.post(Routes.channelMessages(deal.channel_id), {
  body: { embeds: [embed] },
}) as { id: string };

console.log(JSON.stringify({ ok: true, message_id: response.id }));
log.info(`Posted deal "${deal.title}" → message_id=${response.id}`);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Smoke test with a mock context**

```bash
FRANKLIN_TASK_CONTEXT='{"payload":{"upc":"012345678901","title":"Widget Pro","retailer":"Best Buy","price":29.99,"channel_id":"1502059393724715038"},"sqs_message_id":"test-msg-001"}' npx tsx src/scripts/discord_post_deal.ts
```

Expected: `{"ok":true,"message_id":"..."}` — deal embed appears in the test channel

- [ ] **Step 4: Commit**

```bash
git add src/scripts/discord_post_deal.ts
git commit -m "feat: add discord_post_deal script — post deal embed with footer metadata"
```

---

## Task 7: sns_publish_feedback.ts Script

Publishes a 👍/👎 reaction event to the SNS outbox topic.

**Files:**
- Create: `src/scripts/sns_publish_feedback.ts`

- [ ] **Step 1: Create the script**

```ts
#!/usr/bin/env npx tsx
/**
 * Publish deal reaction feedback to the franklin-outbox SNS topic.
 *
 * Context (FRANKLIN_TASK_CONTEXT env var):
 *   message_id   — Discord message that was reacted to
 *   channel_id   — Discord channel
 *   user_id      — Discord user who reacted
 *   emoji        — reaction emoji (👍 / 👎)
 *   reacted_at   — ISO timestamp
 *   sub_type     — event sub_type (e.g. "deal-dash")
 *   meta.upc     — product UPC
 *   meta.title   — product title
 *   meta.retailer — retailer name
 */

import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { createLogger } from "../logger.js";

const log = createLogger("sns_publish_feedback");

interface ReactionContext {
  message_id: string;
  channel_id: string;
  user_id: string;
  emoji: string;
  reacted_at: string;
  sub_type: string;
  meta: { upc: string; title: string; retailer: string; [key: string]: unknown };
}

const raw = process.env.FRANKLIN_TASK_CONTEXT;
if (!raw) {
  log.error("FRANKLIN_TASK_CONTEXT not set");
  process.exit(1);
}

let ctx: ReactionContext;
try {
  ctx = JSON.parse(raw) as ReactionContext;
} catch {
  log.error("FRANKLIN_TASK_CONTEXT is not valid JSON");
  process.exit(1);
}

const TOPIC_ARN =
  process.env.SNS_OUTBOX_ARN ??
  "arn:aws:sns:us-east-2:735029168602:franklin-outbox";

const reaction = ctx.emoji === "👍" ? "up" : ctx.emoji === "👎" ? "down" : ctx.emoji;

const event = {
  event: "deal_feedback",
  reaction,
  deal: {
    upc: ctx.meta.upc,
    title: ctx.meta.title,
    retailer: ctx.meta.retailer,
  },
};

const sns = new SNSClient({ region: "us-east-2" });

await sns.send(
  new PublishCommand({
    TopicArn: TOPIC_ARN,
    Message: JSON.stringify(event),
    MessageAttributes: {
      type: { DataType: "String", StringValue: "deal-dash" },
    },
  }),
);

console.log(JSON.stringify({ ok: true, reaction, deal: event.deal }));
log.info(`Published ${reaction} feedback for UPC ${ctx.meta.upc}`);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Smoke test with a mock context**

```bash
FRANKLIN_TASK_CONTEXT='{"message_id":"1234","channel_id":"1502059393724715038","user_id":"111","emoji":"👍","reacted_at":"2026-05-18T00:00:00Z","sub_type":"deal-dash","meta":{"upc":"012345678901","title":"Widget Pro","retailer":"Best Buy"}}' npx tsx src/scripts/sns_publish_feedback.ts
```

Expected: `{"ok":true,"reaction":"up","deal":{...}}` — verify SNS message received (check CloudWatch or an SNS subscriber)

- [ ] **Step 4: Commit**

```bash
git add src/scripts/sns_publish_feedback.ts
git commit -m "feat: add sns_publish_feedback script — publish deal reaction to SNS outbox"
```

---

## Task 8: Event Handlers Config + Brain Update

Create the initial handler registry and update brain.md to route events through it.

**Files:**
- Create: `state/event_handlers.json`
- Modify: `modes/brain.md`

- [ ] **Step 1: Create `state/event_handlers.json`**

```json
[
  {
    "id": "deal-dash-post",
    "event_type": "deal-dash",
    "sub_type": null,
    "kind": "script",
    "command": "npx tsx src/scripts/discord_post_deal.ts",
    "timeout": 30000,
    "description": "Post deal embed to Discord",
    "context": { "channel_id": "1502059393724715038" }
  },
  {
    "id": "deal-reaction-feedback",
    "event_type": "reaction",
    "sub_type": "deal-dash",
    "kind": "script",
    "command": "npx tsx src/scripts/sns_publish_feedback.ts",
    "timeout": 15000,
    "description": "Publish 👍/👎 feedback to SNS"
  }
]
```

- [ ] **Step 2: Add `state/event_handlers.json` to git tracking**

```bash
git add state/event_handlers.json
```

- [ ] **Step 3: Update `modes/brain.md` Step 1 — add new input files**

Find in Step 1 — Load Inputs:
```
state/scout_results/sqs.json            inbound SQS messages from external services
```

Replace with:
```
state/scout_results/sqs.json            inbound SQS messages from external services
state/event_handlers.json               configurable event handler registry
state/brain_input/discord_reactions.json Discord reaction events (drained by filter-signals)
```

- [ ] **Step 4: Replace brain.md Step 6 with event-handler-aware routing**

Find the entire Step 6 section:
```
## Step 6 — Process SQS Messages

Read `state/scout_results/sqs.json`. Each entry in `entries` is an inbound message from an external service that has not yet been processed.
...
Do not generate a task if an identical `sqs_message_id` already appears in an active quest's context or an inflight task — the message is already being processed.
```

Replace with:

```markdown
## Step 6 — Route Event Messages

### 6a — Load handlers

Read `state/event_handlers.json` as an array. Missing file = empty array. Each handler has:
- `id` — unique handler identifier
- `event_type` — matches `InboundMessage.type` for SQS events, or `"reaction"` for Discord reactions
- `sub_type` — narrows match (`null` = match all sub_types)
- `kind` — `"script"` or `"worker"`
- `command` — required when `kind` is `"script"`
- `timeout` — optional override in ms
- `context` — optional extra fields merged into task context

To match: `handler.event_type === event.type` AND (`handler.sub_type === null` OR `handler.sub_type === event.sub_type`). Use the first matching handler.

### 6b — Route SQS entries

Read `state/scout_results/sqs.json`. Each entry in `entries` is an inbound SQS message.

Entry shape:
```json
{
  "id": "sqs:message:<message_id>",
  "message_id": "<message_id>",
  "type": "deal-dash",
  "sub_type": "string or null",
  "source": "service-name",
  "trace_id": "string or null",
  "payload": { }
}
```

**Skip** entries where `sqs_message_id` already appears in an active quest context or inflight task.

For each remaining entry:
- Find a matching handler from `event_handlers.json`
- **Handler found:** emit a task with:
  - `kind`: from handler (`"script"` or `"worker"`)
  - `command`: from handler (required for scripts)
  - `timeout`: from handler if set
  - `context`: `{ sqs_message_id: entry.message_id, payload: entry.payload, ...handler.context }`
  - `type`: handler id (e.g. `"deal-dash-post"`)
- **No handler found:** apply judgment — generate an appropriate `quest` or `dm_reply` task using the payload content. Always include `sqs_message_id` in context.

**Critical:** Every task from an SQS entry MUST include `sqs_message_id` in context so the supervisor can ack the message after completion.

### 6c — Route Discord reactions

Read `state/brain_input/discord_reactions.json` as an array. Missing file = empty, skip.

Each reaction event shape:
```json
{
  "message_id": "...",
  "channel_id": "...",
  "user_id": "...",
  "emoji": "👍",
  "reacted_at": "ISO 8601",
  "sub_type": "deal-dash",
  "meta": { "upc": "...", "title": "...", "retailer": "..." }
}
```

For each reaction:
- Find a matching handler where `event_type === "reaction"` AND (`sub_type === null` OR `sub_type === reaction.sub_type`)
- If handler found: emit task with `kind`, `command`, `context = { ...reaction, ...handler.context }`
- No `sqs_message_id` on reaction tasks — no SQS acking needed
```

- [ ] **Step 5: Commit**

```bash
git add state/event_handlers.json modes/brain.md
git commit -m "feat: add event_handlers.json and update brain routing for event pipeline"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 3: Test deal-dash → Discord embed flow**

Publish a test message to the SQS inbox:

```bash
aws sqs send-message \
  --queue-url https://sqs.us-east-2.amazonaws.com/735029168602/franklin-inbox \
  --message-body '{"type":"deal-dash","subType":null,"source":"test","payload":{"upc":"012345678901","title":"Test Deal","retailer":"Best Buy","price":19.99}}'
```

Start Franklin and verify the deal embed appears in Discord channel `1502059393724715038` within one cycle (~30s):

```bash
npx tsx franklin.ts
```

- [ ] **Step 4: Test reaction → SNS feedback flow**

React with 👍 to the embed posted in Step 3. Verify within one cycle (~30s):
- `state/brain_input/discord_reactions.json` contains the reaction event after filter-signals runs
- Brain dispatches `sns_publish_feedback` script task
- Script publishes to SNS (check CloudWatch logs or SNS subscriber)

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: <describe fix>"
```
