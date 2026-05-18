import { SQSClient, DeleteMessageBatchCommand } from "@aws-sdk/client-sqs";
import { readJson, writeJson } from "./config.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "./logger.js";

const log = createLogger("sqs-ack");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PENDING_FILE = join(ROOT, "state", "sqs_pending.json");

const QUEUE_URL =
  process.env.SQS_INBOX_URL ??
  "https://sqs.us-east-2.amazonaws.com/735029168602/franklin-inbox";

const sqs = new SQSClient({ region: "us-east-2" });

type PendingMap = Record<string, string>; // message_id → receipt_handle

export async function ackSqsMessages(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;

  const pending = readJson<PendingMap>(PENDING_FILE) ?? {};
  const toDelete = messageIds
    .filter((id) => pending[id])
    .map((id) => ({ Id: id, ReceiptHandle: pending[id] }));

  if (toDelete.length === 0) return;

  // SQS batch delete: max 10 per call
  for (let i = 0; i < toDelete.length; i += 10) {
    const batch = toDelete.slice(i, i + 10);
    try {
      await sqs.send(
        new DeleteMessageBatchCommand({ QueueUrl: QUEUE_URL, Entries: batch }),
      );
      for (const entry of batch) {
        delete pending[entry.Id];
      }
      log.info(`Acked ${batch.length} SQS message(s)`);
    } catch (e: unknown) {
      log.error(`SQS ack batch failed: ${(e as Error).message?.slice(0, 200)}`);
    }
  }

  writeJson(PENDING_FILE, pending);
}
