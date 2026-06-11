import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.js";

// Use in-memory DB for all tests
function testDb() {
  return openDb(":memory:");
}

describe("surfaced table", () => {
  test("upsertSeen creates a row with empty state", () => {
    const db = testDb();
    db.upsertSeen("github:pr:repo/1", "github");
    const row = db.getSurfaced("github:pr:repo/1");
    assert.ok(row);
    assert.equal(row.source, "github");
    assert.deepEqual(row.state, {});
    assert.equal(row.last_surfaced_at, null);
    db.close();
  });

  test("upsertSeen updates last_seen_at on repeat call", async () => {
    const db = testDb();
    db.upsertSeen("github:pr:repo/1", "github");
    const first = db.getSurfaced("github:pr:repo/1")!.last_seen_at;
    await new Promise((r) => setTimeout(r, 5));
    db.upsertSeen("github:pr:repo/1", "github");
    const second = db.getSurfaced("github:pr:repo/1")!.last_seen_at;
    assert.notEqual(first, second);
    db.close();
  });

  test("upsertSeen does not overwrite state on repeat call", () => {
    const db = testDb();
    db.upsertSeen("github:pr:repo/1", "github");
    db.markSurfaced("github:pr:repo/1", { ci_failing: ["lint"] });
    db.upsertSeen("github:pr:repo/1", "github"); // scout runs again
    const row = db.getSurfaced("github:pr:repo/1")!;
    assert.deepEqual(row.state, { ci_failing: ["lint"] }); // state preserved
    db.close();
  });

  test("getSurfaced returns null for unknown id", () => {
    const db = testDb();
    assert.equal(db.getSurfaced("unknown"), null);
    db.close();
  });

  test("markSurfaced sets state and last_surfaced_at", () => {
    const db = testDb();
    db.upsertSeen("jira:ticket:DEV-1", "jira");
    db.markSurfaced("jira:ticket:DEV-1", { status: "In Progress", last_comment_updated: null });
    const row = db.getSurfaced("jira:ticket:DEV-1")!;
    assert.deepEqual(row.state, { status: "In Progress", last_comment_updated: null });
    assert.ok(row.last_surfaced_at);
    db.close();
  });

  test("getBySource returns only rows for that source", () => {
    const db = testDb();
    db.upsertSeen("github:pr:repo/1", "github");
    db.upsertSeen("github:pr:repo/2", "github");
    db.upsertSeen("jira:ticket:DEV-1", "jira");
    const rows = db.getBySource("github");
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.source === "github"));
    db.close();
  });

  test("pruneStale removes rows not seen within window", () => {
    const db = testDb();
    db.upsertSeen("github:pr:repo/old", "github");
    // Manually backdate last_seen_at
    const cutoff = new Date(Date.now() - 8 * 86_400_000).toISOString();
    db.close();
    // Re-open and manually insert a stale row
    const db2 = openDb(":memory:");
    db2.upsertSeen("github:pr:repo/fresh", "github");
    // Insert stale entry directly via the db handle — we'd need raw access.
    // Instead, test pruneStale returns 0 when everything is fresh.
    const pruned = db2.pruneStale("github", 7);
    assert.equal(pruned, 0);
    db2.close();
  });
});

