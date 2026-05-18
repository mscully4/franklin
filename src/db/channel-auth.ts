import type Database from "better-sqlite3";

export interface IsAllowedResult {
  allowed: boolean;
  maxTaskType: "dm_reply" | "quest";
  triggerMode: "all" | "mention" | "none";
  respondToBots: boolean;
}

export function makeChannelAuthMethods(db: InstanceType<typeof Database>) {
  function getChannelPolicy(channelId: string): {
    channel_id: string; name: string | null; trigger_mode: string;
    allowed_users: string; allowed_tasks: string[]; respond_to_bots: boolean;
    updated_at: string; updated_by: string | null;
  } | null {
    const row = db.prepare(`SELECT * FROM channel_policies WHERE channel_id = ?`).get(channelId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      channel_id: row.channel_id as string,
      name: row.name as string | null,
      trigger_mode: row.trigger_mode as string,
      allowed_users: row.allowed_users as string,
      allowed_tasks: JSON.parse(row.allowed_tasks as string),
      respond_to_bots: Boolean(row.respond_to_bots),
      updated_at: row.updated_at as string,
      updated_by: row.updated_by as string | null,
    };
  }

  return {
    getChannelPolicy,

    resolveChannelPolicy(channelId: string, channelType: string): {
      channel_id: string; name: string | null; trigger_mode: string;
      allowed_users: string; allowed_tasks: string[]; respond_to_bots: boolean;
    } {
      const LAST_RESORT = {
        channel_id: "__hardcoded__", name: null, trigger_mode: "mention" as const,
        allowed_users: "owner", allowed_tasks: ["dm_reply"], respond_to_bots: false,
      };
      const exact = getChannelPolicy(channelId);
      if (exact) return exact;
      if (channelType === "im") {
        const im = getChannelPolicy("im");
        if (im) return im;
      }
      const def = getChannelPolicy("__default__");
      if (def) return def;
      return LAST_RESORT;
    },

    getUserOverride(channelId: string, userId: string): {
      permission: string; allowed_tasks: string[] | null;
    } | null {
      const row = db.prepare(
        `SELECT permission, allowed_tasks FROM channel_user_rules WHERE channel_id = ? AND user_id = ?`
      ).get(channelId, userId) as { permission: string; allowed_tasks: string | null } | undefined;
      if (!row) return null;
      return {
        permission: row.permission,
        allowed_tasks: row.allowed_tasks ? JSON.parse(row.allowed_tasks) : null,
      };
    },

    isAllowed(
      channelId: string, channelType: string, userId: string,
      ownerId: string, authorizedIds: Set<string>,
    ): IsAllowedResult {
      const NOT_ALLOWED: IsAllowedResult = { allowed: false, maxTaskType: "dm_reply", triggerMode: "none", respondToBots: false };

      const override = this.getUserOverride(channelId, userId);
      if (override?.permission === "deny") return NOT_ALLOWED;

      const policy = this.resolveChannelPolicy(channelId, channelType);

      if (!override) {
        const users = policy.allowed_users;
        if (users === "owner" && userId !== ownerId) return NOT_ALLOWED;
        if (users === "authorized" && !authorizedIds.has(userId)) return NOT_ALLOWED;
        if (users !== "owner" && users !== "authorized" && users !== "any") {
          try {
            const arr = JSON.parse(users) as string[];
            if (!arr.includes(userId)) return NOT_ALLOWED;
          } catch { return NOT_ALLOWED; }
        }
      }

      const tasks = override?.allowed_tasks ?? policy.allowed_tasks;
      const maxTaskType = tasks.includes("quest") ? "quest" as const : "dm_reply" as const;

      return {
        allowed: true,
        maxTaskType,
        triggerMode: policy.trigger_mode as "all" | "mention" | "none",
        respondToBots: policy.respond_to_bots,
      };
    },

    listChannelPolicies(): Array<{
      channel_id: string; name: string | null; trigger_mode: string;
      allowed_users: string; allowed_tasks: string[]; respond_to_bots: boolean;
      updated_at: string; updated_by: string | null;
    }> {
      const rows = db.prepare(`SELECT * FROM channel_policies ORDER BY channel_id`).all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        channel_id: row.channel_id as string,
        name: row.name as string | null,
        trigger_mode: row.trigger_mode as string,
        allowed_users: row.allowed_users as string,
        allowed_tasks: JSON.parse(row.allowed_tasks as string),
        respond_to_bots: Boolean(row.respond_to_bots),
        updated_at: row.updated_at as string,
        updated_by: row.updated_by as string | null,
      }));
    },

    listUserRules(channelId?: string): Array<{
      channel_id: string; user_id: string; permission: string;
      allowed_tasks: string[] | null; updated_at: string; updated_by: string | null;
    }> {
      const query = channelId
        ? db.prepare(`SELECT * FROM channel_user_rules WHERE channel_id = ? ORDER BY user_id`)
        : db.prepare(`SELECT * FROM channel_user_rules ORDER BY channel_id, user_id`);
      const rows = (channelId ? query.all(channelId) : query.all()) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        channel_id: row.channel_id as string,
        user_id: row.user_id as string,
        permission: row.permission as string,
        allowed_tasks: row.allowed_tasks ? JSON.parse(row.allowed_tasks as string) : null,
        updated_at: row.updated_at as string,
        updated_by: row.updated_by as string | null,
      }));
    },

    upsertChannelPolicy(fields: {
      channel_id: string; name?: string; trigger_mode: string;
      allowed_users: string; allowed_tasks: string[]; respond_to_bots: boolean;
    }, updatedBy: string): void {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO channel_policies (channel_id, name, trigger_mode, allowed_users, allowed_tasks, respond_to_bots, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
          name = excluded.name,
          trigger_mode = excluded.trigger_mode,
          allowed_users = excluded.allowed_users,
          allowed_tasks = excluded.allowed_tasks,
          respond_to_bots = excluded.respond_to_bots,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).run(
        fields.channel_id, fields.name ?? null, fields.trigger_mode,
        fields.allowed_users, JSON.stringify(fields.allowed_tasks),
        fields.respond_to_bots ? 1 : 0, now, updatedBy,
      );
    },

    upsertUserRule(fields: {
      channel_id: string; user_id: string; permission: string;
      allowed_tasks?: string[];
    }, updatedBy: string): void {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO channel_user_rules (channel_id, user_id, permission, allowed_tasks, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel_id, user_id) DO UPDATE SET
          permission = excluded.permission,
          allowed_tasks = excluded.allowed_tasks,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).run(
        fields.channel_id, fields.user_id, fields.permission,
        fields.allowed_tasks ? JSON.stringify(fields.allowed_tasks) : null,
        now, updatedBy,
      );
    },

    removeUserRule(channelId: string, userId: string): void {
      db.prepare(`DELETE FROM channel_user_rules WHERE channel_id = ? AND user_id = ?`).run(channelId, userId);
    },
  };
}
