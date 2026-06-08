# immich — Self-Hosted Photo & Video Management

Use the `immich-go` CLI to interact with an Immich server. This is the community Go-based alternative to the official Node.js CLI.

## Authentication

immich-go needs a server URL and API key. These are read from environment variables by Franklin, then passed as CLI flags:

```bash
export IMMICH_SERVER="http://your-ip:2283"   # or https://your-domain
export IMMICH_API_KEY="your-api-key"
```

Get an API key from your Immich web UI: **Administration → Settings → API Keys**.

> **Note:** Some operations (like `--pause-immich-jobs`) also accept `--admin-api-key` for managing server-side jobs. If you need this, set `IMMICH_ADMIN_API_KEY` in `.env`.

## Commands

### Upload

Upload photos to the Immich server from various sources.

```bash
immich-go upload from-folder /path/to/photos \
  --server "$IMMICH_SERVER" \
  --api-key "$IMMICH_API_KEY"
```

**Subcommands:**

| Subcommand | Source |
|---|---|
| `from-folder` | Local directory of photos/videos |
| `from-google-photos` | Google Photos takeout (zipped or extracted) |
| `from-icloud` | iCloud takeout folder or zip |
| `from-immich` | Another Immich server |
| `from-picasa` | Picasa folder or zip |

**Key flags for upload:**

```
--dry-run                  Simulate without uploading
--tag "tag1/subtag1"       Add tags (can repeat, supports hierarchy)
--session-tag              Tag with "{immich-go}/YYYY-MM-DD HH-MM-SS"
--overwrite                Overwrite server versions with local
--manage-heic-jpeg ...     Handle HEIC+JPEG pairs (NoStack/KeepHeic/KeepJPG/StackCoverHeic/StackCoverJPG)
--manage-raw-jpeg ...      Handle RAW+JPEG pairs (same options)
--manage-burst ...         Handle burst photos (NoStack/Stack/StackKeepRaw/StackKeepJPEG)
--pause-immich-jobs        Pause Immich background jobs during upload (default true)
--device-uuid string       Set device UUID (default "ubuntu-server-1")
--no-ui                    Disable the TUI progress display
```

### Archive

Archive photos from various sources to a local filesystem (no upload).

```bash
immich-go archive from-google-photos takeout.zip \
  --write-to-folder ./archive
```

Same subcommands as upload (`from-folder`, `from-google-photos`, `from-icloud`, `from-immich`, `from-picasa`).

Key flag: `-w, --write-to-folder` — destination path for the archive.

### Stack

Update stacking relationships for photos already on the server.

```bash
immich-go stack \
  --server "$IMMICH_SERVER" \
  --api-key "$IMMICH_API_KEY" \
  --manage-raw-jpeg StackKeepRaw
```

Accepts the same `--manage-*` flags as upload. Use `--date-range` to limit scope.

### Utility

```bash
immich-go version              # Show version info
immich-go --save-config        # Save current flags to immich-go.yaml
```

## Global Flags

```
--config string            Config file path (default ./immich-go.yaml)
--dry-run                  Simulate all actions
--log-level string         DEBUG|INFO|WARN|ERROR (default INFO)
--log-file string          Write logs to file
--log-type string          text or JSON
--concurrent-tasks int     Number of concurrent tasks 1-20 (default 32)
--on-errors OnErrorsFlag   stop, continue, or accept N errors
```

## Common Patterns

### Upload a folder with tags and dry-run first

```bash
# Preview what would be uploaded
immich-go upload from-folder ~/Pictures/vacation \
  --server "$IMMICH_SERVER" \
  --api-key "$IMMICH_API_KEY" \
  --tag "vacation" \
  --tag "2024" \
  --dry-run

# Actually upload
immich-go upload from-folder ~/Pictures/vacation \
  --server "$IMMICH_SERVER" \
  --api-key "$IMMICH_API_KEY" \
  --tag "vacation" \
  --tag "2024"
```

### Import a Google Photos takeout

```bash
immich-go upload from-google-photos takeout.zip \
  --server "$IMMICH_SERVER" \
  --api-key "$IMMICH_API_KEY" \
  --session-tag
```

### Archive Google Photos takeout locally without uploading

```bash
immich-go archive from-google-photos takeout.zip \
  --write-to-folder ~/archives/google-photos-2024
```

## Output

immich-go shows a progress TUI during uploads. Use `--no-ui` for plain text output (better for scripting). Use `--log-type json` for machine-readable logs.

## Error Handling

| Flag | Behavior |
|---|---|
| `--on-errors stop` | Stop on first error (default) |
| `--on-errors continue` | Skip errors and keep going |
| `--on-errors 5` | Accept up to 5 errors, then stop |
