import type Database from "better-sqlite3";

export function makeDeployMethods(db: InstanceType<typeof Database>) {
  return {
    insertDeploy(entry: {
      id: string;
      service: string;
      description?: string;
      requester?: string;
      recommendation?: string;
      evidence?: string;
      message_url?: string;
    }): void {
      const now = new Date().toISOString();
      const evidenceAt = entry.evidence ? now : null;
      db.prepare(`
        INSERT OR REPLACE INTO deploys (id, service, description, requester, recommendation, evidence, evidence_at, message_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entry.id, entry.service, entry.description ?? null, entry.requester ?? null,
        entry.recommendation ?? null, entry.evidence ?? null, evidenceAt, entry.message_url ?? null, now);
    },

    upsertDeployIfNew(entry: {
      id: string;
      service: string;
      description?: string;
      requester?: string;
      status?: string;
      message_url?: string;
      created_at?: string;
    }): void {
      const now = entry.created_at ?? new Date().toISOString();
      db.prepare(`
        INSERT INTO deploys (id, service, description, requester, status, message_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status
      `).run(entry.id, entry.service, entry.description ?? null, entry.requester ?? null,
        entry.status ?? "pending", entry.message_url ?? null, now);
    },

    removeDeploysNotIn(activeIds: string[]): number {
      if (!activeIds.length) {
        return db.prepare(`DELETE FROM deploys`).run().changes;
      }
      const placeholders = activeIds.map(() => "?").join(",");
      return db.prepare(`DELETE FROM deploys WHERE id NOT IN (${placeholders})`).run(...activeIds).changes;
    },

    getRecentDeploys(limit = 10): Array<{
      id: string; service: string; description: string | null; requester: string | null;
      recommendation: string | null; evidence: string | null; message_url: string | null;
      status: string; created_at: string;
    }> {
      return db.prepare(`SELECT * FROM deploys ORDER BY created_at DESC LIMIT ?`).all(limit) as ReturnType<
        ReturnType<typeof makeDeployMethods>["getRecentDeploys"]
      >;
    },

    getPendingDeploysNeedingReview(): Array<{
      id: string; service: string; description: string | null; requester: string | null;
      message_url: string | null; status: string; created_at: string; evidence_at: string | null;
    }> {
      const staleThreshold = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      return db.prepare(
        `SELECT id, service, description, requester, message_url, status, created_at, evidence_at
         FROM deploys WHERE status = 'pending'
           AND (evidence IS NULL OR evidence = '' OR evidence_at < ?)
         ORDER BY created_at ASC`
      ).all(staleThreshold) as ReturnType<
        ReturnType<typeof makeDeployMethods>["getPendingDeploysNeedingReview"]
      >;
    },

    pruneDeploys(days = 7): number {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      return db.prepare(`DELETE FROM deploys WHERE created_at < ?`).run(cutoff).changes;
    },
  };
}
