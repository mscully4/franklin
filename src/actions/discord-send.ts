#!/usr/bin/env npx tsx
/**
 * Send Discord messages as the Franklin bot.
 *
 * Usage:
 *   npx tsx src/actions/discord-send.ts message --channel_id 123456789012345678 --text "hello"
 *   npx tsx src/actions/discord-send.ts message --user_id 475783212891897857 --text "hello"
 */

import { REST, Routes } from "discord.js";
import { createLogger } from "../logger.js";
const log = createLogger("discord");

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

const [, , command, ...rest] = process.argv;
const args = parseArgs(rest);

async function main() {
  if (command === "message") {
    if (!args.text) {
      log.error("Usage: discord_send.ts message --channel_id <id> --text <text>  OR  --user_id <id> --text <text>");
      process.exit(1);
    }
    const token = getDiscordToken();
    const rest = new REST().setToken(token);

    let channelId = args.channel_id;
    if (!channelId && args.user_id) {
      const dm = await rest.post(Routes.userChannels(), {
        body: { recipient_id: args.user_id },
      }) as { id: string };
      channelId = dm.id;
    }
    if (!channelId) {
      log.error("Must provide --channel_id or --user_id");
      process.exit(1);
    }

    const data = await rest.post(Routes.channelMessages(channelId), {
      body: { content: args.text },
    }) as { id: string };
    console.log(JSON.stringify({ ok: true, message_id: data.id }));
  } else {
    log.error("Commands: message");
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(JSON.stringify({ ok: false, error: (err as Error).message }));
  process.exit(1);
});
