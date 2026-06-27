#!/usr/bin/env bash
# send-to-kindle.sh — Add a book to the Calibre library, convert to AZW3, and email to Kindle.
#
# Usage:
#   send-to-kindle.sh /path/to/book.epub          # From a file
#   send-to-kindle.sh --id 42                      # From an existing library book by ID
#
# Config in ~/franklin/.env:
#   CALIBRE_FROM_EMAIL   — sender (must be on Amazon's Approved Senders list)
#   CALIBRE_KINDLE_EMAIL — destination @kindle.com address
#
# Uses gws (Google Workspace CLI) for OAuth-based Gmail sending — no SMTP app passwords.

set -euo pipefail

LIBRARY_PATH="${CALIBRE_LIBRARY_PATH:-$HOME/calibre-library}"
ENV_FILE="$HOME/franklin/.env"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── Load config ────────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: .env not found at $ENV_FILE" >&2
    exit 1
fi
set -a; source "$ENV_FILE"; set +a

for var in CALIBRE_FROM_EMAIL CALIBRE_KINDLE_EMAIL; do
    if [[ -z "${!var:-}" ]]; then
        echo "ERROR: $var is not set in $ENV_FILE" >&2
        exit 1
    fi
done

FROM_EMAIL="$CALIBRE_FROM_EMAIL"
KINDLE_EMAIL="$CALIBRE_KINDLE_EMAIL"

# ── Resolve the book ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--id" ]]; then
    BOOK_ID="${2:-}"
    if [[ -z "$BOOK_ID" ]]; then
        echo "ERROR: --id requires a numeric book ID" >&2
        exit 1
    fi

    echo "📚 Looking up book ID $BOOK_ID in library..."
    BOOK_PATH=$(calibredb --library-path="$LIBRARY_PATH" show "$BOOK_ID" 2>/dev/null | grep -oP "/[^ ]+\.(epub|mobi|pdf|azw3|azw)" | head -1)
    if [[ -z "$BOOK_PATH" ]]; then
        echo "ERROR: Could not find a readable format for book ID $BOOK_ID" >&2
        exit 1
    fi
    BOOK_TITLE=$(calibredb --library-path="$LIBRARY_PATH" list --fields=title --search="id:$BOOK_ID" 2>/dev/null | tail -n +2 | sed 's/^[0-9]* *//')
    echo "   → $BOOK_TITLE ($(basename "$BOOK_PATH"))"

else
    INPUT_FILE="${1:-}"
    if [[ -z "$INPUT_FILE" || ! -f "$INPUT_FILE" ]]; then
        echo "Usage: send-to-kindle.sh /path/to/book.epub   OR   send-to-kindle.sh --id 42" >&2
        exit 1
    fi

    echo "📥 Adding to library: $INPUT_FILE"
    calibredb --library-path="$LIBRARY_PATH" add "$INPUT_FILE" 2>&1

    BASENAME=$(basename "$INPUT_FILE")
    BOOK_PATH=$(find "$LIBRARY_PATH" -name "$BASENAME" -not -path '*/.calnotes/*' 2>/dev/null | head -1)
    if [[ -z "$BOOK_PATH" ]]; then
        echo "ERROR: Could not locate book in library after adding" >&2
        exit 1
    fi
    BOOK_TITLE=$(basename "$INPUT_FILE" | sed 's/\.[^.]*$//')
fi

# ── Convert to AZW3 ────────────────────────────────────────────────────────────
# gws requires attachments to be in the current directory, so we work from $WORK_DIR
EXT="${BOOK_PATH##*.}"
if [[ "$EXT" == "azw3" || "$EXT" == "azw" ]]; then
    SEND_FILE="$BOOK_PATH"
    echo "✅ Already AZW3, skipping conversion"
else
    SEND_FILE="$WORK_DIR/$(basename "${BOOK_PATH%.*}.azw3")"
    echo "🔄 Converting $EXT → AZW3..."
    ebook-convert "$BOOK_PATH" "$SEND_FILE" 2>&1 | tail -3
    echo "✅ Conversion complete"
fi

# ── Email to Kindle via Gmail API ──────────────────────────────────────────────
echo "📧 Sending to $KINDLE_EMAIL..."
cd "$WORK_DIR"
gws gmail +send \
    --to "$KINDLE_EMAIL" \
    --from "$FROM_EMAIL" \
    --subject "Send to Kindle: $BOOK_TITLE" \
    --body "Sent by Franklin." \
    -a "$(basename "$SEND_FILE")"

echo "✅ Sent to Kindle: $BOOK_TITLE"

# ── Backup to S3 ────────────────────────────────────────────────────────────────
if command -v aws &>/dev/null; then
    echo "☁️  Backing up to S3..."
    aws s3 sync "$LIBRARY_PATH/" s3://scully-calibre-library/ --quiet 2>&1 || echo "⚠️  S3 backup failed (non-fatal)"
fi
