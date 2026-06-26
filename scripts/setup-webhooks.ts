#!/usr/bin/env npx tsx
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(
  readFileSync(join(__dirname, "../state/settings.json"), "utf-8")
);

const { github_owner, repos } = settings.webhook;
const secret = process.env.WEBHOOK_SECRET;
const public_url = process.env.WEBHOOK_PUBLIC_URL;

if (!secret) {
  console.error("WEBHOOK_SECRET env var is not set");
  process.exit(1);
}
if (!public_url) {
  console.error("WEBHOOK_PUBLIC_URL env var is not set");
  process.exit(1);
}

for (const repo of repos as { github: string; local: string }[]) {
  const slug = `${github_owner}/${repo.github}`;

  // Check if a webhook for this URL already exists
  const existing = JSON.parse(
    execSync(`gh api repos/${slug}/hooks`, { encoding: "utf-8" })
  ) as { id: number; config: { url: string } }[];

  const alreadyExists = existing.some((h) => h.config.url === public_url);
  if (alreadyExists) {
    console.log(`[${slug}] webhook already exists, skipping`);
    continue;
  }

  execSync(
    `gh api repos/${slug}/hooks --method POST ` +
      `--field name=web ` +
      `--field active=true ` +
      `--field 'events[]=push' ` +
      `--field 'config[url]=${public_url}' ` +
      `--field 'config[content_type]=json' ` +
      `--field 'config[secret]=${secret}'`,
    { stdio: "inherit" }
  );

  console.log(`[${slug}] webhook created`);
}
