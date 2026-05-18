import type Database from "better-sqlite3";

export function makeInboxMethods(db: InstanceType<typeof Database>) {
  return {
    insertSlackEvent(event: {
      event_ts: string;
      channel: string;
      channel_type: string;
      user_id?: string;
      type: string;
      reaction?: string;
      text?: string;
      thread_ts?: string;
      raw: Record<string, unknown>;
    }): void {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO slack_inbox
          (event_ts, channel, channel_type, user_id, type, reaction, text, thread_ts, raw, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.event_ts,
        event.channel,
        event.channel_type,
        event.user_id ?? null,
        event.type,
        event.reaction ?? null,
        event.text ?? null,
        event.thread_ts ?? null,
        JSON.stringify(event.raw),
        now,
      );
    },

    getPendingSlackEvents(): Array<{
      event_ts: string;
      channel: string;
      channel_type: string;
      user_id: string | null;
      type: string;
      reaction: string | null;
      text: string | null;
      thread_ts: string | null;
      raw: Record<string, unknown>;
      received_at: string;
    }> {
      const rows = db.prepare(`
        SELECT * FROM slack_inbox WHERE processed = 0 ORDER BY event_ts ASC
      `).all() as Array<Record<string, unknown>>;
      return rows.map((r) => ({ ...r, raw: JSON.parse(r.raw as string) })) as ReturnType<
        ReturnType<typeof makeInboxMethods>["getPendingSlackEvents"]
      >;
    },

    markSlackEventsProcessed(eventTs: string[]): void {
      if (eventTs.length === 0) return;
      const placeholders = eventTs.map(() => "?").join(",");
      db.prepare(`UPDATE slack_inbox SET processed = 1 WHERE event_ts IN (${placeholders})`).run(...eventTs);
    },

    pruneSlackInbox(days = 2): number {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
      const result = db.prepare(`DELETE FROM slack_inbox WHERE processed = 1 AND received_at < ?`).run(cutoff);
      return result.changes;
    },
  };
}
