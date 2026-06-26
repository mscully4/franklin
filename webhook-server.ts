import express, { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const settings = JSON.parse(
  readFileSync(join(__dirname, "state/settings.json"), "utf-8")
);

const { port: PORT, ws_dir: WS_DIR, repos } = settings.webhook;

const SECRET = process.env.WEBHOOK_SECRET;
if (!SECRET) throw new Error("WEBHOOK_SECRET env var is not set");

// Map GitHub repo name (lowercase) → absolute local path
const repoMap: Map<string, string> = new Map(
  (repos as { github: string; local: string }[]).map(({ github, local }) => [
    github.toLowerCase(),
    join(WS_DIR, local),
  ])
);

const app = express();

app.use(express.raw({ type: "application/json" }));

function findLocalRepo(repoName: string): string | null {
  return repoMap.get(repoName.toLowerCase()) ?? null;
}

function verifySignature(body: Buffer, sig: string): boolean {
  const expected = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

app.post("/webhook", (req: Request, res: Response) => {
  const sig = req.headers["x-hub-signature-256"] as string | undefined;

  if (!sig || !verifySignature(req.body as Buffer, sig)) {
    console.error("Webhook: invalid or missing signature");
    res.status(401).send("Unauthorized");
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse((req.body as Buffer).toString());
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  const ref: string = payload.ref ?? "";
  const repoName: string = payload.repository?.name ?? "";

  if (ref !== "refs/heads/master") {
    res.status(200).send(`Skipped (ref: ${ref})`);
    return;
  }

  const localPath = findLocalRepo(repoName);
  if (!localPath) {
    console.error(`Webhook: repo "${repoName}" not found in ${WS_DIR}`);
    res.status(404).send("Repo not found");
    return;
  }

  try {
    execSync("git fetch origin", { cwd: localPath });
    const output = execSync("git reset --hard origin/master", { cwd: localPath, encoding: "utf-8" });
    console.log(`[${repoName}] reset to origin/master:\n${output.trim()}`);
    res.status(200).send("OK");
  } catch (err: any) {
    console.error(`[${repoName}] sync failed:`, err.message);
    res.status(500).send("sync failed");
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
