# Email Triage

Fetch unread emails, flag important ones, filter spam. Run daily.

## Phase 1 — Gather

```bash
gws gmail +triage --format json --max 50 > /tmp/email-triage.json

# Fetch existing Gmail filters to avoid re-suggesting already-filtered senders
gws gmail users settings filters list --params '{"userId": "me"}' --format json > /tmp/gmail-filters.json
```

Extract already-filtered senders from `/tmp/gmail-filters.json`:
```bash
jq '.filter[] | .criteria.from' -r /tmp/gmail-filters.json | sort
```

These are senders that already have Gmail filters set up to auto-archive. **Do not suggest them again.**

## Phase 2 — Classify

For each unread email, classify into one of:

### Already filtered
If the sender's address (or domain) is in the existing filter list from Phase 1, mark as **already filtered** and skip. Do not include in any category below.

### Important
- Replies to threads you participated in (thread has your replies)
- Emails from people in `~/brain/people/` (known contacts)
- Financial: bank alerts, credit card notices, bill pay confirmations
- Travel: flight/hotel/rental car confirmations, itinerary changes
- Legal/tax: CPA, lawyer, IRS, tax prep
- Transactional: password resets, 2FA codes, security alerts
- Calendar invites

### Spam candidates
- Cold outreach / sales pitches from unknown senders
- Newsletters you never open (check if sender has been seen 5+ times with no reply)
- Marketing/promotional from companies you don't use
- Recruiter spam (generic "exciting opportunity" templates)
- "Thanks for subscribing" / "Welcome to our newsletter" for things you didn't sign up for
- **IMPORTANT:** Before suggesting a sender, verify it is NOT in the existing filter list from Phase 1. Only suggest NEW senders.

### Neutral
- Everything else — receipts, shipping notifications, social media updates, etc.

## Phase 3 — Act

### For important emails:
List them in the DM with subject + sender + one-line summary.

### For already-filtered emails:
Count them. Don't list individually — just include the count in the report.

### For spam candidates:
Only include senders NOT already in the filter list. Suggest adding them. Format as:

```
Filter suggestions:
1. "sender@example.com" — [reason, e.g., "5 emails, never opened"]
2. "newsletter@spam.co" — [reason]

Reply "filter 1 2" to add them.
```

## Phase 4 — Apply Filters

When user confirms ("filter 1 2"):

1. Create a Gmail filter to auto-archive (use the `recipe-create-gmail-filter` skill):
   ```bash
   gws gmail users settings filters create --params '{"userId": "me"}' --json '{"criteria": {"from": "sender@example.com"}, "action": {"addLabelIds": ["Label_<N>"], "removeLabelIds": ["INBOX"]}}'
   ```
   The `gws gmail users settings filters create` command creates a filter that skips the inbox (archive). Use `gws gmail users labels create --params '{"userId": "me"}' --json '{"name": "Noise/<Sender>"}'` first to create the label if needed.

2. Update `state/gmail_noise_senders.json` with the new sender.

## Message Format

Send to the channel_id from task context:

```
📬 Triage — [Date]

Important (N):
- "[Subject]" | From: [Name] — [one-line summary]
- ...

Filter suggestions (N):
1. sender@example.com — [reason]
2. ...

Neutral: N emails (receipts, shipping, etc.)
Already filtered: N emails from N senders (skipped)
```
