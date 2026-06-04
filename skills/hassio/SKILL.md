---
name: hassio
description: "Home Assistant: query and control smart home devices."
triggers:
  - "turn on the lights"
  - "turn off the"
  - "what's the temperature"
  - "is the garage door open"
  - "smart home"
  - "home assistant"
  - "hassio"
  - "check the house"
  - "lock the door"
  - "set the thermostat"
  - "close the garage"
metadata:
  version: 0.1.0
  requires:
    env:
      - HASSIO_URL
      - HASSIO_TOKEN
    bins:
      - hassio
---

# hassio — Home Assistant CLI

Use the `hassio` CLI to query and control smart home devices via the Home Assistant REST + WebSocket API.

## Authentication

`hassio` reads `HASSIO_URL` and `HASSIO_TOKEN` from the environment. These are already set — no config needed.

```bash
hassio info --format toon   # verify connectivity
```

## Output Format

Always use `--format toon` — it's the most token-efficient output format.

## Discovery Workflow

Don't guess entity IDs. Discover what's available:

```bash
# 1. What domains exist?
hassio entities --domains --format toon

# 2. List entities in a domain
hassio entities --domain switch --format toon
hassio entities --domain light --format toon
hassio entities --domain sensor --format toon

# 3. Inspect an entity for full details (attributes, state, last changed)
hassio inspect switch.garage_light --format toon

# 4. What physical devices are registered? (manufacturer, model, area)
hassio registries --devices --format toon
```

Entity state alone won't tell you a switch is a TP-Link HS200 in the garage — the device registry will.

## Commands by Domain

### Switches & Lights

```bash
hassio switch on switch.garage_light
hassio switch off switch.garage_light
hassio switch toggle switch.garage_light
hassio light on light.living_room --brightness 128
```

### Sensors & Binary Sensors (read-only)

```bash
hassio entities --domain sensor --format toon
hassio entities --domain binary_sensor --format toon
hassio sensor --format toon
```

### Climate (thermostats, AC)

```bash
hassio climate --format toon
hassio climate set climate.living_room --temperature 72
hassio climate set_hvac_mode climate.living_room --mode heat
```

### Covers (blinds, garage doors)

```bash
hassio cover open cover.garage_door
hassio cover close cover.garage_door
```

### Device Trackers & Persons

```bash
hassio device-tracker --format toon
hassio persons --format toon
```

### Weather & Sun

```bash
hassio weather --format toon
hassio sun --format toon
```

### Query (LLM-friendly search)

```bash
hassio query "lights that are on" --format toon
hassio query "temperature sensors" --format toon
```

### Service Calls

For anything not covered by a domain subcommand, call the HA service directly:

```bash
hassio services --format toon
hassio call-service light turn_on --params '{"entity_id": "light.living_room", "brightness": 128}'
```

## Safety Rules

- **Read-only by default** — `entities`, `inspect`, `registries`, `query`, `sensor`, `weather`, `sun`, `persons`, `device-tracker` are always safe.
- **Write only when instructed** — `toggle`, `set`, `call-service` are fine when the task explicitly asks for them. No need to confirm; just do it.
- **Use `--read-only` flag** when exploring unfamiliar domains — it blocks all state-changing calls at the CLI level.
- **Batch cautiously** — `hassio batch` can chain multiple service calls. Review the full batch before running.

## Common Patterns

### Quick status check

```bash
hassio query "lights and switches that are on" --format toon
hassio query "doors and windows that are open" --format toon
```

### Check a room

```bash
hassio registries --devices --format toon | grep -i kitchen
hassio query "kitchen" --format toon
```

### Turn everything off

```bash
hassio query "lights that are on" --format toon
# Review the list, then toggle individually or use:
hassio call-service light turn_off --params '{"entity_id": "all"}'
```

## Quick Reference

| Task | Command |
|---|---|
| What's in my house? | `hassio registries --devices --format toon` |
| What domains exist? | `hassio entities --domains --format toon` |
| List switches | `hassio entities --domain switch --format toon` |
| Inspect entity | `hassio inspect <entity_id> --format toon` |
| Toggle a switch | `hassio switch toggle <entity_id>` |
| Set thermostat | `hassio climate set <entity_id> --temperature 72` |
| Find by name | `hassio query "garage" --format toon` |
| System info | `hassio info --format toon` |
