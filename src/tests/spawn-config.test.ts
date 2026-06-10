import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildBrainSpawnConfig } from "../supervisor/pipeline.js";
import { buildWorkerSpawnConfig } from "../supervisor/task-manager.js";

// ── Brain ────────────────────────────────────────────────────────────────────

describe("buildBrainSpawnConfig", () => {
  test("brain runs in /tmp", () => {
    const { cwd } = buildBrainSpawnConfig("/some/root", "/nonexistent");
    assert.equal(cwd, "/tmp");
  });

  test("brain args include --bare", () => {
    const { args } = buildBrainSpawnConfig("/some/root", "/nonexistent");
    assert.ok(args.includes("--bare"));
  });

  test("brain args include --add-dir pointing to root", () => {
    const { args } = buildBrainSpawnConfig("/some/root", "/nonexistent");
    const idx = args.indexOf("--add-dir");
    assert.notEqual(idx, -1, "--add-dir flag missing");
    assert.equal(args[idx + 1], "/some/root");
  });

  test("brain args do NOT include --plugin-dir", () => {
    const { args } = buildBrainSpawnConfig("/some/root", "/nonexistent");
    assert.ok(!args.includes("--plugin-dir"), "--plugin-dir must not be passed to the brain");
  });

  test("brain prompt includes playbook list when playbooks exist", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "franklin-playbooks-"));
    try {
      writeFileSync(join(tmpDir, "foo.md"), "");
      writeFileSync(join(tmpDir, "bar.md"), "");
      writeFileSync(join(tmpDir, "not-a-playbook.txt"), "");
      const { args } = buildBrainSpawnConfig("/some/root", tmpDir);
      const prompt = args[args.indexOf("-p") + 1];
      assert.ok(prompt.includes("foo.md"), "prompt should list foo.md");
      assert.ok(prompt.includes("bar.md"), "prompt should list bar.md");
      assert.ok(!prompt.includes("not-a-playbook.txt"), "non-.md files should be excluded");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("brain prompt has no playbook line when directory is missing", () => {
    const { args } = buildBrainSpawnConfig("/some/root", "/nonexistent/playbooks");
    const prompt = args[args.indexOf("-p") + 1];
    assert.ok(!prompt.includes("Available playbooks"), "no playbook line when dir missing");
  });
});

// ── Worker ───────────────────────────────────────────────────────────────────

describe("buildWorkerSpawnConfig", () => {
  test("worker runs in /tmp", () => {
    const { cwd } = buildWorkerSpawnConfig("/some/root", null, "do stuff");
    assert.equal(cwd, "/tmp");
  });

  test("worker args include --bare", () => {
    const { args } = buildWorkerSpawnConfig("/some/root", null, "do stuff");
    assert.ok(args.includes("--bare"));
  });

  test("worker args include --add-dir pointing to root", () => {
    const { args } = buildWorkerSpawnConfig("/some/root", null, "do stuff");
    const idx = args.indexOf("--add-dir");
    assert.notEqual(idx, -1, "--add-dir flag missing");
    assert.equal(args[idx + 1], "/some/root");
  });

  test("worker args include --plugin-dir when integration skills exist", () => {
    const { args } = buildWorkerSpawnConfig("/some/root", "/tmp/franklin-integrations", "do stuff");
    const idx = args.indexOf("--plugin-dir");
    assert.notEqual(idx, -1, "--plugin-dir flag missing");
    assert.equal(args[idx + 1], "/tmp/franklin-integrations");
  });

  test("worker args do NOT include --plugin-dir when no integration skills", () => {
    const { args } = buildWorkerSpawnConfig("/some/root", null, "do stuff");
    assert.ok(!args.includes("--plugin-dir"), "--plugin-dir must not appear when pluginDir is null");
  });

  test("worker prompt arg is included", () => {
    const { args } = buildWorkerSpawnConfig("/some/root", null, "my task prompt");
    const idx = args.indexOf("-p");
    assert.notEqual(idx, -1, "-p flag missing");
    assert.equal(args[idx + 1], "my task prompt");
  });
});
