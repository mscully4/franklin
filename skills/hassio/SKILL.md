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
  version: 0.2.0
  requires:
    env:
      - HASS_SERVER
      - HASS_TOKEN
    bins:
      - hass-cli
---

# hass-cli — Home Assistant CLI

Use `hass-cli` (the official [home-assistant-cli](https://github.com/home-assistant-ecosystem/home-assistant-cli)) to query and control smart home devices.

## Authentication

`hass-cli` reads `HASS_SERVER` and `HASS_TOKEN` from the environment. These are already set — no config needed.

```bash
hass-cli config release   # verify connectivity
```

## Output Format

Use `-o yaml` for readable output on entity details. Use default table format for lists.

## Discovery Workflow

Don't guess entity IDs. Discover what's available:

```bash
# 1. What entities exist?
hass-cli state list

# 2. What domains are in use?
hass-cli state list --no-headers | awk '{print $1}' | cut -d. -f1 | sort -u

# 3. Filter to a specific domain
hass-cli state list --filter 'entity_id like "switch.%"'
hass-cli state list --filter 'entity_id like "light.%"'
hass-cli state list --filter 'entity_id like "sensor.%"'

# 4. Inspect an entity (YAML for full details)
hass-cli state get -o yaml switch.garage_light

# 5. List devices
hass-cli device list
```

## Commands

### State (read entities)

```bash
hass-cli state list                                          # All entities
hass-cli state list --filter 'entity_id like "light.%"'      # Lights only
hass-cli state get -o yaml light.living_room                 # Single entity
hass-cli state list --filter 'state == "on"'                 # Entities that are on
```

### Service Calls (control)

```bash
# List available services
hass-cli service list
hass-cli service list --filter 'domain == "switch"'

# Call a service
hass-cli service call switch.turn_on --arguments entity_id=switch.garage_light
hass-cli service call switch.turn_off --arguments entity_id=switch.garage_light
hass-cli service call switch.toggle --arguments entity_id=switch.garage_light
hass-cli service call light.turn_on --arguments 'entity_id=light.living_room,brightness=128'
hass-cli service call climate.set_temperature --arguments 'entity_id=climate.living_room,temperature=72'
hass-cli service call cover.open_cover --arguments entity_id=cover.garage_door
hass-cli service call cover.close_cover --arguments entity_id=cover.garage_door
```

### Devices & Areas

```bash
hass-cli device list                          # All devices
hass-cli device list --filter 'area_id=="kitchen"'  # Kitchen devices
hass-cli area list                            # All areas
```

### System

```bash
hass-cli config release                       # HA version
hass-cli system health                        # System health
hass-cli system log                           # Recent errors
```

### Raw API

```bash
hass-cli raw get /api/states                  # Raw API call
hass-cli raw get /api/config                  # Config dump
```

### History

```bash
hass-cli state history --since 50m light.kitchen_light_1
hass-cli state history --since 2026-06-27
```

## Safety Rules

- **Read-only by default** — `state list`, `state get`, `device list`, `area list`, `config`, `system health` are always safe.
- **Write only when instructed** — `service call` is fine when the task explicitly asks for it. No need to confirm; just do it.
- **Batch cautiously** — chain multiple calls in one script. Review before running.

## Common Patterns

### Quick status check

```bash
hass-cli state list --filter 'domain == "light" and state == "on"'
hass-cli state list --filter 'domain == "binary_sensor" and state == "on"'
```

### Check a room

```bash
hass-cli device list | grep -i kitchen
```

### Turn everything off

```bash
hass-cli state list --filter 'domain == "light" and state == "on"'
# Review the list, then toggle individually
```

### Who's home?

```bash
hass-cli state list --filter 'domain == "person"'
```

## Quick Reference

| Task | Command |
|---|---|
| HA version | `hass-cli config release` |
| System health | `hass-cli system health` |
| All entities | `hass-cli state list` |
| Lights only | `hass-cli state list --filter 'entity_id like "light.%"'` |
| Inspect entity | `hass-cli state get -o yaml <entity_id>` |
| Toggle switch | `hass-cli service call switch.toggle --arguments entity_id=<id>` |
| Turn on light | `hass-cli service call light.turn_on --arguments entity_id=<id>` |
| Set brightness | `hass-cli service call light.turn_on --arguments 'entity_id=<id>,brightness=128'` |
| Set thermostat | `hass-cli service call climate.set_temperature --arguments 'entity_id=<id>,temperature=72'` |
| Open garage | `hass-cli service call cover.open_cover --arguments entity_id=<id>` |
| List devices | `hass-cli device list` |
