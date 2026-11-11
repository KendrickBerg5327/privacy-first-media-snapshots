import { createHash } from "node:crypto";
import { z } from "zod";
import { ensureBucket, infrai } from "./infrai_storage.ts";

export const snapshotRequestSchema = z.object({
  snapshotDate: z.string().date(),
  assets: z.array(z.object({
    assetId: z.string().min(1),
    creatorId: z.string().min(1),
    state: z.enum(["ingested", "processing", "ready"]),
    bytes: z.number().int().nonnegative(),
  })),
  processingJobs: z.array(z.object({
    jobId: z.string().min(1),
    assetId: z.string().min(1),
    state: z.enum(["queued", "running", "completed", "failed"]),
    outputAssetId: z.string().min(1).optional(),
  })),
  creatorDeliveries: z.array(z.object({
    deliveryId: z.string().min(1),
    creatorId: z.string().min(1),
    assetId: z.string().min(1),
    state: z.enum(["pending", "delivered"]),
  })),
}).strict();

export type SnapshotRequest = z.infer<typeof snapshotRequestSchema>;

export type SnapshotDocument = {
  schemaVersion: 1;
  snapshotDate: string;
  assets: Array<Omit<SnapshotRequest["assets"][number], "creatorId"> & { creatorRef: string }>;
  processingJobs: SnapshotRequest["processingJobs"];
  creatorDeliveries: Array<Omit<SnapshotRequest["creatorDeliveries"][number], "creatorId"> & { creatorRef: string }>;
};

function privateCreatorRef(creatorId: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${creatorId}`).digest("hex").slice(0, 24);
}

export function buildSnapshot(input: SnapshotRequest, salt: string): SnapshotDocument {
  const creatorRef = (creatorId: string) => privateCreatorRef(creatorId, salt);
  return {
    schemaVersion: 1,
    snapshotDate: input.snapshotDate,
    assets: input.assets.map(({ creatorId, ...asset }) => ({ ...asset, creatorRef: creatorRef(creatorId) })),
    processingJobs: input.processingJobs,
    creatorDeliveries: input.creatorDeliveries.map(({ creatorId, ...delivery }) => ({
      ...delivery,
      creatorRef: creatorRef(creatorId),
    })),
  };
}

export async function storeNightlySnapshot(input: SnapshotRequest): Promise<{ bucket: string; key: string; records: number }> {
  const bucket = process.env.SNAPSHOT_BUCKET ?? "media-nightly-snapshots";
  const salt = process.env.SNAPSHOT_PRIVACY_SALT;
  if (!salt) throw new Error("Set SNAPSHOT_PRIVACY_SALT before starting the service");

  const document = buildSnapshot(input, salt);
  const key = `nightly/${input.snapshotDate}/media-streaming.json`;
  const idempotencyKey = `media-snapshot-${input.snapshotDate}`;
  await ensureBucket(bucket);
  const signed = await infrai.storage.object.presign(bucket, key, idempotencyKey);
  const upload = await fetch(signed.url, {
    method: "PUT",
    headers: { ...(signed.headers ?? {}), "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
  if (!upload.ok) throw new Error(`Signed upload was rejected (${upload.status})`);

  return {
    bucket,
    key,
    records: document.assets.length + document.processingJobs.length + document.creatorDeliveries.length,
  };
}
