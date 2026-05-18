#!/usr/bin/env npx tsx
import { SQSClient, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { InboundMessageSchema } from "../schemas.js";
import type { InboundMessage } from "../schemas.js";
import { readJson, writeJson } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("sqs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RESULT_FILE = join(ROOT, "state", "scout_results", "sqs.json");
const PENDING_FILE = join(ROOT, "state", "sqs_pending.json");

const QUEUE_URL =
  process.env.SQS_INBOX_URL ??
  "https://sqs.us-east-2.amazonaws.com/735029168602/franklin-inbox";

const sqs = new SQSClient({ region: "us-east-2" });

type PendingMap = Record<string, string>; // message_id → receipt_handle

export interface SqsEntry {
  id: string;
  message_id: string;
  type: InboundMessage["type"];
  sub_type: string | null;
  source: string;
  trace_id: string | null;
  payload: Record<string, unknown>;
  received_at: string;
}

async function main(): Promise<void> {
  const receivedAt = new Date().toISOString();
  const entries: SqsEntry[] = [];
  const errors: string[] = [];

  // Load existing pending map — messages already in-flight
  const pending: PendingMap = readJson<PendingMap>(PENDING_FILE) ?? {};

  let raw;
  try {
    raw = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
      }),
    );
  } catch (e: unknown) {
    const msg = (e as Error).message?.slice(0, 200) ?? "unknown";
    log.error(`SQS receive failed: ${msg}`);
    errors.push(msg);
    raw = { Messages: [] };
  }

  for (const msg of raw.Messages ?? []) {
    if (!msg.MessageId || !msg.Body || !msg.ReceiptHandle) continue;

    // Re-delivered message (visibility timeout expired before ack) — update
    // receipt handle but don't add to entries again (already being processed)
    if (pending[msg.MessageId]) {
      pending[msg.MessageId] = msg.ReceiptHandle;
      log.warn(`messageId=${msg.MessageId} re-delivered — updated receipt handle`);
      continue;
    }

    let body: unknown;
    try {
      body = JSON.parse(msg.Body);
    } catch {
      errors.push(`messageId=${msg.MessageId}: invalid JSON`);
      continue;
    }

    const parsed = InboundMessageSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      log.warn(`messageId=${msg.MessageId} failed validation: ${issues}`);
      errors.push(`messageId=${msg.MessageId}: ${issues}`);
      // Leave invalid messages in queue — they'll DLQ after 3 retries
      continue;
    }

    const { type, subType, source, traceId, payload } = parsed.data;

    entries.push({
      id: `sqs:message:${msg.MessageId}`,
      message_id: msg.MessageId,
      type,
      sub_type: subType,
      source,
      trace_id: traceId ?? null,
      payload,
      received_at: receivedAt,
    });

    // Track receipt handle — deleted only after successful task completion
    pending[msg.MessageId] = msg.ReceiptHandle;
  }

  writeJson(PENDING_FILE, pending);

  const result = {
    scout: "sqs",
    collected_at: receivedAt,
    status: errors.length === 0 ? "ok" : "error",
    error: errors.length > 0 ? errors.join("; ") : null,
    entries,
  };

  mkdirSync(join(ROOT, "state", "scout_results"), { recursive: true });
  writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));

  log.info(`${entries.length} new messages, ${Object.keys(pending).length} in-flight, ${errors.length} errors → ${RESULT_FILE}`);
}

main();
