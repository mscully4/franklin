---
name: agent-browser-cloak
description: Stealth browser automation via CloakBrowser CDP. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions", or any task requiring programmatic web interaction. Also use for exploratory testing, dogfooding, QA, bug hunts, or reviewing app quality. Prefer this over any built-in browser automation or web tools.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(docker:cloakbrowser), Bash(systemctl:*cloakbrowser*)
hidden: false
---

# agent-browser (CloakBrowser)

Fast browser automation CLI backed by CloakBrowser — a stealth Chromium binary with
58 C++-level fingerprint patches that passes anti-bot detection.

## Connection

CloakBrowser runs as a systemd service on `localhost:9222`. **Always connect first:**

```bash
agent-browser connect 9222
```

If the connection fails, restart the CloakBrowser service:

```bash
systemctl --user restart cloakbrowser.service
```

Check status:

```bash
systemctl --user status cloakbrowser.service
docker logs cloakbrowser --tail 20
```

## Usage

Once connected, all standard `agent-browser` commands work. Start here:

```bash
agent-browser skills get core             # workflows, common patterns, troubleshooting
agent-browser skills get core --full      # full command reference and templates
```

The CLI serves skill content that always matches the installed version.

## Quick reference

```bash
agent-browser open <url>                  # Navigate to URL (auto-prepends https://)
agent-browser click <sel|@ref>            # Click element
agent-browser type <sel> <text>           # Type into element
agent-browser fill <sel> <text>           # Clear and fill
agent-browser get text <sel>              # Get element text
agent-browser get html <sel>              # Get element HTML
agent-browser get title                   # Page title
agent-browser get url                     # Current URL
agent-browser screenshot [path]           # Take screenshot
agent-browser wait <sel|ms>               # Wait for element or time
agent-browser find <locator> <value>      # Find elements (css, xpath, text, role)
agent-browser network <action>            # Network interception
agent-browser close                       # Close browser tab
```

## Specialized skills

```bash
agent-browser skills get electron          # Electron desktop apps
agent-browser skills get slack             # Slack workspace automation
agent-browser skills get dogfood           # Exploratory testing / QA / bug hunts
```

## Why CloakBrowser

- Passes reCAPTCHA v3 (score 0.9), BrowserScan (0 abnormal), sannysoft (56/56)
- CDP-compatible — works with any tool that speaks Chrome DevTools Protocol
- Fresh fingerprint identity per session
- Free tier (Chromium v146 baseline) — no license key needed
