# Franklin — Agent Browser Guide

Read this file when `"mscully:agent-browser"` is in `integrations`. Covers when and how workers should use browser automation.

---

## What It Is

`agent-browser` is a fast Rust CLI for browser automation via Chrome/Chromium CDP. No Playwright or Puppeteer dependency. Workers can navigate pages, fill forms, click buttons, take screenshots, scrape data, and automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion).

## When to Use

Use agent-browser when a task requires interacting with something that doesn't have an API or MCP tool:

- **Web scraping / data extraction** — pull data from a dashboard, status page, or site with no API
- **Form filling** — submit a web form, complete a checkout flow, fill a survey
- **Screenshots** — capture a page or element for the user
- **QA / exploratory testing** — dogfood a web app, verify a deploy looks right
- **Electron apps** — interact with Slack, Discord, VS Code, Figma, Notion if the API/MCP route is insufficient

Do NOT use agent-browser when a dedicated API, MCP tool, or CLI exists (e.g., use `gh` for GitHub, `gws` for Google Workspace, `mmoney` for Monarch, Discord gateway for messages).

## Getting Started

Before running any `agent-browser` commands, load the workflow content:

```bash
agent-browser skills get core
```

For specialized tasks:

```bash
agent-browser skills get electron     # Electron desktop apps
agent-browser skills get slack        # Slack workspace automation
agent-browser skills get dogfood      # Exploratory testing / QA
```

Run `agent-browser skills list` to see everything available.

## Key Commands

The CLI uses accessibility-tree snapshots with `@eN` element refs for reliable interaction. Common patterns:

```bash
agent-browser open <url>              # Navigate to a page
agent-browser snapshot                # Get accessibility tree with element refs
agent-browser click @e5               # Click an element by ref
agent-browser type @e3 "hello"        # Type into an input
agent-browser screenshot              # Capture the current page
agent-browser extract                 # Extract page content as markdown
agent-browser close                   # Close the browser
```

Always run `agent-browser skills get core` first in a session — it loads the full command reference matching your installed version.

## Observability

A dashboard runs on port 4848. Workers can check session state there if needed, but normally just use the CLI.

## Rules

- **Read-only by default** — scraping, screenshots, and data extraction are always allowed
- **Write operations** (form submission, purchases, configuration changes) require the task objective to explicitly require it AND user approval
- **Auth** — agent-browser has a credential vault. If a site requires login, ask the user whether credentials are stored or if they want to add them
- **Cleanup** — close the browser when done (`agent-browser close`)
- Log all agent-browser usage in the quest log with `action: "info_received"` and `platform: "agent-browser"`
