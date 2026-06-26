---
name: google-health
description: "Google Health API: query Fitbit activity, sleep, and health metrics."
triggers:
  - "fitbit"
  - "steps"
  - "sleep"
  - "heart rate"
  - "health data"
  - "activity"
  - "how much did I walk"
  - "how did I sleep"
  - "resting heart rate"
  - "calories burned"
  - "active minutes"
  - "google health"
metadata:
  version: 0.1.0
  requires:
    env:
      - GOOGLE_HEALTH_CLIENT_ID
      - GOOGLE_HEALTH_CLIENT_SECRET
      - GOOGLE_HEALTH_REFRESH_TOKEN
---

# google-health — Google Health API (Fitbit)

Data comes from a Fitbit Charge 6 via the Google Health API. No CLI — all calls are `curl` against `https://health.googleapis.com/v4`.

## Authentication

Access tokens expire after 1 hour. Always refresh before making calls:

```bash
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${GOOGLE_HEALTH_CLIENT_ID}&client_secret=${GOOGLE_HEALTH_CLIENT_SECRET}&refresh_token=${GOOGLE_HEALTH_REFRESH_TOKEN}&grant_type=refresh_token" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

Store in `ACCESS_TOKEN` and use as `Authorization: Bearer $ACCESS_TOKEN` on every request.

## Base URL & User Path

```
https://health.googleapis.com/v4/users/me/dataTypes/{data-type}/dataPoints
```

## Filter Syntax

Filters follow [AIP-160](https://google.aip.dev/160). Time ranges use civil time (local) or physical time (UTC).

```
# Interval data (steps, distance, active-minutes, calories-burned, floors)
steps.interval.civil_start_time >= "YYYY-MM-DD" AND steps.interval.civil_start_time < "YYYY-MM-DD"

# Sample data (heart-rate, weight, body-fat)
heart-rate.sample_time.civil_time >= "YYYY-MM-DD" AND heart-rate.sample_time.civil_time < "YYYY-MM-DD"

# Sleep (filter by end time — when the person woke up)
sleep.interval.civil_end_time >= "YYYY-MM-DD" AND sleep.interval.civil_end_time < "YYYY-MM-DD"
```

Pass filters via `-G --data-urlencode "filter=..."` to avoid shell escaping issues.

## Data Types

| Data type | Key in response | Notes |
|---|---|---|
| `steps` | `steps.count` | Per-minute buckets from Fitbit |
| `distance` | `distance.meters` | |
| `active-minutes` | `activeMinutes.value` | |
| `calories-burned` | `caloriesBurned.kcal` | |
| `floors` | `floors.count` | |
| `heart-rate` | `heartRate.beatsPerMinute` | Per-reading samples |
| `sleep` | `sleep.*` | Session-level, not minute buckets |
| `weight` | `weight.massKg` | Only if logged |
| `body-fat` | `bodyFat.percentage` | Only if logged |

## Common Queries

### Steps today
```bash
TODAY=$(date +%Y-%m-%d)
TOMORROW=$(date -d '1 day' +%Y-%m-%d)
curl -s -G "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints" \
  --data-urlencode "filter=steps.interval.civil_start_time >= \"${TODAY}\" AND steps.interval.civil_start_time < \"${TOMORROW}\"" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
total = sum(int(p['steps']['count']) for p in data.get('dataPoints', []))
print(f'Steps today: {total:,}')
"
```

### Sleep last night
```bash
TODAY=$(date +%Y-%m-%d)
TOMORROW=$(date -d '1 day' +%Y-%m-%d)
curl -s -G "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints" \
  --data-urlencode "filter=sleep.interval.civil_end_time >= \"${TODAY}\" AND sleep.interval.civil_end_time < \"${TOMORROW}\"" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -m json.tool
```

### Resting heart rate (latest readings)
```bash
curl -s "https://health.googleapis.com/v4/users/me/dataTypes/heart-rate/dataPoints?pageSize=10" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
readings = [int(p['heartRate']['beatsPerMinute']) for p in data.get('dataPoints', [])]
if readings:
    print(f'Latest HR: {readings[0]} bpm | Avg (last {len(readings)}): {sum(readings)//len(readings)} bpm')
"
```

### Steps over a date range
```bash
START="2026-06-20"
END="2026-06-27"
curl -s -G "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints" \
  --data-urlencode "filter=steps.interval.civil_start_time >= \"${START}\" AND steps.interval.civil_start_time < \"${END}\"" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c "
import sys, json
from collections import defaultdict
data = json.load(sys.stdin)
by_day = defaultdict(int)
for p in data.get('dataPoints', []):
    d = p['steps']['interval']['civilStartTime']['date']
    day = f\"{d['year']}-{d['month']:02d}-{d['day']:02d}\"
    by_day[day] += int(p['steps']['count'])
for day in sorted(by_day):
    print(f'{day}: {by_day[day]:,} steps')
"
```

## Pagination

Large date ranges return a `nextPageToken`. Page through with `&pageToken=<token>` until no token is returned.

## Profile

```bash
curl -s "https://health.googleapis.com/v4/users/-/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -m json.tool
```

## Notes

- Data updates after the Fitbit app syncs (auto-sync every ~15 min when app is open, or manual sync).
- Steps come in per-minute buckets — always sum them for a daily total.
- Sleep sessions filter by `civil_end_time` (wake time), not start time.
- The device is a **Fitbit Charge 6**; `dataSource.platform` will be `"FITBIT"`.
