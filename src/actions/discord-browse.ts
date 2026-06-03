#!/usr/bin/env npx tsx
/**
 * Browse Discord servers as the Franklin bot.
 *
 * Usage:
 *   npx tsx src/actions/discord-browse.ts guilds
 *   npx tsx src/actions/discord-browse.ts channels --guild_id <id>
 *   npx tsx src/actions/discord-browse.ts messages --channel_id <id> [--limit 20]
 */

import { REST, Routes } from "discord.js";
import { createLogger } from "../logger.js";
const log = createLogger("discord-browse");

function getDiscordToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN not set — check .env file");
  return token;
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

interface GuildInfo {
  id: string;
  name: string;
  owner_id: string;
}

interface ChannelInfo {
  id: string;
  name: string;
  type: number;
  topic?: string | null;
  last_message_id?: string | null;
}

interface MessageInfo {
  id: string;
  author: string;
  content: string;
  timestamp: string;
}

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

async function main() {
  const token = getDiscordToken();
  const rest = new REST().setToken(token);

  if (command === "guilds") {
    const guilds = await rest.get(Routes.userGuilds()) as GuildInfo[];
    const out = guilds.map((g) => ({ id: g.id, name: g.name }));
    console.log(JSON.stringify({ ok: true, guilds: out }));
  } else if (command === "channels") {
    if (!args.guild_id) {
      log.error("Usage: discord-browse.ts channels --guild_id <id>");
      process.exit(1);
    }
    const channels = await rest.get(Routes.guildChannels(args.guild_id)) as ChannelInfo[];
    const textChannels = channels
      .filter((c) => c.type === 0) // GuildText only
      .map((c) => ({
        id: c.id,
        name: c.name,
        topic: c.topic ?? null,
      }));
    console.log(JSON.stringify({ ok: true, guild_id: args.guild_id, channels: textChannels }));
  } else if (command === "messages") {
    if (!args.channel_id) {
      log.error("Usage: discord-browse.ts messages --channel_id <id> [--limit 20]");
      process.exit(1);
    }
    const limit = Math.min(parseInt(args.limit ?? "20", 10) || 20, 100);
    const msgs = await rest.get(Routes.channelMessages(args.channel_id), {
      query: new URLSearchParams({ limit: String(limit) }),
    }) as Array<{ id: string; author: { username: string }; content: string; timestamp: string }>;

    const out: MessageInfo[] = msgs.map((m) => ({
      id: m.id,
      author: m.author.username,
      content: m.content,
      timestamp: m.timestamp,
    }));
    console.log(JSON.stringify({ ok: true, channel_id: args.channel_id, messages: out }));
  } else {
    log.error("Commands: guilds | channels | messages");
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(JSON.stringify({ ok: false, error: (err as Error).message }));
  process.exit(1);
});
