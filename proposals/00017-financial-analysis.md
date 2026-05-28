# 00017 — Financial Analysis via mmoney

## Status: Design

## Goal

Give Franklin the ability to analyze financial data from Monarch Money via the mmoney CLI. Four capabilities: answer ad-hoc questions, detect anomalies on a schedule, audit subscriptions for changes, and fix miscategorized transactions.

## Design Decisions

- **Direct CLI always** — no transaction caching in brain. Every question hits mmoney live. Fresh data every time.
- **Brain for metadata only** — account list, institution map, category map. Not balances or transactions.
- **Both ad-hoc + scheduled** — on-demand questions via natural language, anomaly/subscription/categorization checks on a cadence.

## Capabilities

### 1. Ad-Hoc Questions

Natural language → mmoney commands. Examples:
- "How much did I spend on Amazon last month?"
- "What's my net worth right now?"
- "Show me all transactions over $500 this month"
- "What's my savings rate this year?"

Implementation: Map questions to mmoney CLI calls. Question intent classifier → command builder → mmoney call → formatted answer.

### 2. Anomaly Detection (Scheduled)

Rules to flag (context-aware, not just thresholds):
- Transaction >$500 AND from a new/unknown merchant (first occurrence in 3+ months)
- Transaction >$500 AND in a category with no other activity that period (e.g., lone hotel charge with no travel companions)
- Transaction >2x the 3-month average for that merchant (e.g., grocery run suddenly 5x normal)
- Category spending >30% above rolling 3-month average
- New recurring charge detected (merchant not in known recurring list)
- Income drop >20% month-over-month
- Large uncategorized transaction (>$500)

Anti-pattern to avoid: flagging a $500 hotel when flights, restaurants, and other travel expenses surround it — that's a trip, not an anomaly.

### 3. Subscription Audit (Scheduled)

- Track recurring charges over time
- Flag amount changes (e.g., Fashionpass $96→$135)
- Flag new subscriptions
- Flag ones that look forgotten (no transactions from that merchant in 3+ months? or just flag for review)

### 4. Categorization Fixes

- Find transactions with suspicious category/merchant pairings
- Find uncategorized or default-categorized transactions
- Present batch for review → apply fixes via `--allow-mutations`
- Never auto-fix without confirmation

## Open Questions

- [x] Categorization fixes: weekly
- [x] Anomaly detection: weekly
- [x] Subscription audit: monthly
- [x] Large transaction threshold: $500, but context-dependent (see anomaly rules)
- [x] Delivery: Discord DM for all alerts and reports
- [ ] Categorization: ask-first always, or auto-fix obvious cases?

## Implementation Notes

- Skill: `.claude/skills/finance-analyst/`
- Brain metadata: `~/brain/finance/accounts.md`, `~/brain/finance/categories.md`
- Playbook: `playbooks/finance-check.md` for scheduled runs
- Uses mmoney CLI directly, `-f json` always, jq for parsing
