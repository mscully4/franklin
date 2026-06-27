# Calibre — E-Book Library & Kindle Delivery

Manage the user's e-book library and deliver books to their Kindle device via email.

## Library

**Path:** `~/calibre-library/` (synced to S3: `s3://scully-calibre-library/`)

All `calibredb` commands must include `--library-path=~/calibre-library`.

## Commands

### List books

```bash
calibredb --library-path=~/calibre-library list --fields=title,authors,tags
calibredb --library-path=~/calibre-library list --search "Agatha Christie"
calibredb --library-path=~/calibre-library list --sort=title
```

### Add a book

```bash
calibredb --library-path=~/calibre-library add /path/to/book.epub
```

Adding a book automatically copies it into the library. You can also pass `--authors "Name"` and `--title "Title"` to set metadata at import time.

### Search

```bash
calibredb --library-path=~/calibre-library search "author:Christie"
calibredb --library-path=~/calibre-library search "tags:fiction"
```

### Remove a book

```bash
calibredb --library-path=~/calibre-library remove 42
```

**Confirm with the user before removing books.**

### Show book details

```bash
calibredb --library-path=~/calibre-library show 42
```

### Convert formats

```bash
ebook-convert input.epub output.azw3
ebook-convert input.epub .azw3   # output file derives name from input
```

`ebook-convert` guesses the output format from the file extension. Common targets: `.azw3` (Kindle), `.mobi` (older Kindle), `.epub` (universal), `.pdf`.

### Set metadata

```bash
calibredb --library-path=~/calibre-library set_metadata 42 --field=tags:"Fiction,Mystery"
```

---

## Kindle Email Delivery

Books are sent to the user's Kindle device via email. Amazon converts the attachment and delivers it over Whispernet.

**Recipient:** `CALIBRE_KINDLE_EMAIL` in `~/franklin/.env`
**Sender:** configured in `~/franklin/.env` (CALIBRE_SMTP_* vars)

### Delivery script

`~/franklin/scripts/send-to-kindle.sh` handles the full pipeline:

1. Adds the book to the Calibre library (if not already present)
2. Converts to AZW3 format (Kindle-native)
3. Emails the AZW3 to the user's @kindle.com address via SMTP

```bash
# Send an EPUB to Kindle (auto-converts to AZW3)
~/franklin/scripts/send-to-kindle.sh /path/to/book.epub

# Send a book that's already in the library, by ID
~/franklin/scripts/send-to-kindle.sh --id 42
```

### SMTP config

Set in `~/franklin/.env`. Sending uses `gws` (Google Workspace CLI) with OAuth — no SMTP app passwords needed.

```
CALIBRE_FROM_EMAIL=franklin.bot.email@gmail.com
CALIBRE_KINDLE_EMAIL=michael.scully1997@kindle.com
```

`CALIBRE_FROM_EMAIL` must be a Gmail address you can send-as (GWS handles this). It must also be on Amazon's Approved Personal Document E-mail List for Kindle delivery to work.

### How delivery works

1. Amazon only delivers files from addresses on the user's **Approved Personal Document E-mail List** (managed in Amazon's Content & Devices → Preferences).
2. The sender address (`SMTP_FROM`) must be on that approved list.
3. Subject line and body are irrelevant — Amazon ignores them and delivers the attachment.

---

## S3 Backup

The library syncs to S3 for backup. Run manually or via cron:

```bash
aws s3 sync ~/calibre-library/ s3://scully-calibre-library/
```

To restore from backup onto another machine:

```bash
aws s3 sync s3://scully-calibre-library/ ~/calibre-library/
```

---

## Workflows

### "Send me book X"

When the user asks for a book by title/author:

1. Check if it's already in the library: `calibredb --library-path=~/calibre-library list --search "SEARCH_TERMS"`
2. If not found: download the book (see below), add to library, send to Kindle
3. If found: confirm they want it sent to Kindle, then run `send-to-kindle.sh --id ID`

### Downloading books

Franklin can source books via:
- **agent-browser** integration — navigate to storefronts, authenticate if needed
- Direct download URLs provided by the user
- Public domain sources (Project Gutenberg, Standard Ebooks)

**Important:** Only download books the user has legal rights to. When in doubt, ask.

### Monthly backup

Run `aws s3 sync ~/calibre-library/ s3://scully-calibre-library/` after adding new books. No need to schedule — just do it as part of the "book added" workflow.
