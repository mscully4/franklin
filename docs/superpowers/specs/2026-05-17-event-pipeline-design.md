# Franklin — Event Pipeline Framework

**Date:** 2026-05-17
**Status:** Approved

## Overview

Extend Franklin with a configurable event pipeline: inbound events (SQS messages, Discord reactions) are matched against a handler registry and dispatched as script or worker tasks. First use case: deal-dash publishes deals to SQS → Franklin posts embed to Discord → user reacts 👍/👎 → Franklin publishes feedback to SNS.

## Architecture

```
deal-dash scraper
      │
      ▼
SQS (franklin-inbox)          Discord gateway (server.ts)
      │                               │
      ▼                               ▼
SQS scout (existing)        messageReactionAdd handler (new)
      │                               │
      ▼                               ▼
state/scout_results/sqs.json   state/discord_reactions.json
            │                         │
            └──────────┬──────────────┘
                       ▼
              Brain (reads event_handlers.json)
              matches event_type → dispatches
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
    kind: "script"           kind: "worker"
  discord_post_deal.ts    Claude worker (reasoning)
  sns_publish_feedback.ts
          │
          ▼
  Discord embed post / SNS publish
```

## Components

### New files

| File | Purpose |
|---|---|
| `state/event_handlers.json` | Handler registry — editable by worker at runtime |
| `state/discord_reactions.json` | Reaction events written by gateway, drained by brain each cycle |
| `src/scripts/discord_post_deal.ts` | Reads deal payload from task context, posts embed to Discord channel (channel ID from task context, not hardcoded), writes message_id to result |
| `src/scripts/sns_publish_feedback.ts` | Reads reaction + deal context, publishes feedback event to franklin-outbox SNS |
| `src/schemas.ts` additions | `EventHandlerSchema`, `ReactionEventSchema` |

### Modified files

| File | Change |
|---|---|
| `server.ts` | Add `GuildMessageReactions` intent + `messageReactionAdd` handler |
| `modes/brain.md` | New section: load event_handlers.json + discord_reactions.json, match and dispatch |
| `src/schemas.ts` | Add new schemas |

### No CDK changes needed

SQS inbox (`franklin-inbox`) and SNS outbox (`franklin-outbox`) already provisioned in `MessagingStack`.

## Schemas

### `event_handlers.json`

```json
[
  {
    "id": "deal-dash-post",
    "event_type": "deal-dash",
    "sub_type": null,
    "kind": "script",
    "command": "npx tsx src/scripts/discord_post_deal.ts",
    "timeout": 30000,
    "description": "Post deal embed to Discord"
  },
  {
    "id": "deal-reaction-feedback",
    "event_type": "reaction",
    "sub_type": "deal-dash",
    "kind": "script",
    "command": "npx tsx src/scripts/sns_publish_feedback.ts",
    "timeout": 15000,
    "description": "Publish reaction feedback to SNS"
  }
]
```

`event_type` matches `InboundMessage.type` for SQS events, or `"reaction"` for Discord reaction events. `sub_type` narrows the match (null = match all sub_types).

### `discord_reactions.json`

Array drained each brain cycle (same pattern as `slack_inbox.json`):

```json
[
  {
    "message_id": "1234567890",
    "channel_id": "1502059393724715038",
    "user_id": "...",
    "emoji": "👍",
    "reacted_at": "2026-05-17T00:00:00.000Z",
    "sub_type": "deal-dash",
    "meta": { "upc": "012345678901", "title": "...", "retailer": "..." }
  }
]
```

`sub_type` and `meta` extracted from the original Discord embed footer at reaction time (no local state file needed — metadata lives in the embed).

### SNS feedback event shape

```json
{
  "event": "deal_feedback",
  "reaction": "up",
  "deal": { "upc": "...", "title": "...", "retailer": "..." }
}
```

## Embed Metadata Strategy

`discord_post_deal.ts` encodes deal metadata in the embed footer as JSON:

```ts
footer: { text: JSON.stringify({ sub_type: "deal-dash", upc: deal.upc, title: deal.title, retailer: deal.retailer }) }
```

`messageReactionAdd` in `server.ts` fetches the original message, parses footer, includes metadata in the reaction event. Survives bot restarts — no local state file required.

## Brain Changes

New brain.md section after existing input loading:

1. Read `state/event_handlers.json` — handler registry
2. Read `state/discord_reactions.json` — drain reaction events (read, then write `[]` to clear, same pattern as `slack_inbox.json`)
3. For each SQS entry in `scout_results/sqs.json`: match `type` + `subType` against handlers → dispatch
4. For each reaction in `discord_reactions.json`: match `"reaction"` + `sub_type` against handlers → dispatch
5. For `kind: "script"` handlers: emit delegation with `kind: "script"`, `command`, task context = event payload
6. For `kind: "worker"` handlers: emit delegation with full context for LLM reasoning

## Error Handling

| Failure | Behavior |
|---|---|
| Discord post fails | Script exits non-zero → `status: "error"` → SQS message stays pending → re-delivered after visibility timeout |
| Reaction fetch fails | Gateway logs warn, skips writing reaction. Silently dropped — feedback is not critical path |
| SNS publish fails | Script exits non-zero → brain sees error on next cycle. SNS publish is idempotent — safe to retry |
| Bot restart | No state lost — reaction metadata lives in Discord embed, not memory |

## Testing

- Unit tests: `EventHandlerSchema` + `ReactionEventSchema` in `src/tests/schemas.test.ts`
- Scripts receive payload via task context in `delegation.json` (same as all worker scripts) — testable standalone by writing a minimal delegation file
- End-to-end: publish test deal to SQS → verify embed posts → react 👍 → verify SNS event published
