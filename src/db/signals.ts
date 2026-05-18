import type Database from "better-sqlite3";

export interface SurfacedRow {
  id: string;
  source: string;
  created_at: string;
  last_surfaced_at: string | null;
  last_seen_at: string;
  state: Record<string, unknown>;
}

export function makeSignalsMethods(db: InstanceType<typeof Database>) {
  return {
    upsertSeen(id: string, source: string): void {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO surfaced (id, source, created_at, last_seen_at, state)
        VALUES (?, ?, ?, ?, '{}')
        ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
      `).run(id, source, now, now);
    },

    getSurfaced(id: string): SurfacedRow | null {
      const row = db.prepare(`SELECT * FROM surfaced WHERE id = ?`).get(id) as
        | (Omit<SurfacedRow, "state"> & { state: string })
        | undefined;
      if (!row) return null;
      return { ...row, state: JSON.parse(row.state) };
    },

    getBySource(source: string): SurfacedRow[] {
      const rows = db.prepare(`SELECT * FROM surfaced WHERE source = ?`).all(source) as Array<
        Omit<SurfacedRow, "state"> & { state: string }
      >;
      return rows.map((r) => ({ ...r, state: JSON.parse(r.state) }));
    },

    markSurfaced(id: string, state: Record<string, unknown>): void {
      const now = new Date().toISOString();
      db.prepare(`UPDATE surfaced SET last_surfaced_at = ?, state = ? WHERE id = ?`)
        .run(now, JSON.stringify(state), id);
    },

    pruneStale(source: string, days = 7): number {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const result = db.prepare(`DELETE FROM surfaced WHERE source = ? AND last_seen_at < ?`)
        .run(source, cutoff);
      return result.changes;
    },

    addInflightPr(signalId: string, taskId: string, pid: number | null): void {
      db.prepare(`
        INSERT OR REPLACE INTO inflight_prs (signal_id, task_id, pid, started_at)
        VALUES (?, ?, ?, ?)
      `).run(signalId, taskId, pid, new Date().toISOString());
    },

    removeInflightPr(signalId: string): void {
      db.prepare(`DELETE FROM inflight_prs WHERE signal_id = ?`).run(signalId);
    },

    getInflightPrs(): Array<{ signal_id: string; task_id: string; pid: number | null; started_at: string }> {
      return db.prepare(`SELECT * FROM inflight_prs`).all() as Array<{
        signal_id: string; task_id: string; pid: number | null; started_at: string;
      }>;
    },
  };
}
