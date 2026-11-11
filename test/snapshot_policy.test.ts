import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshot, snapshotRequestSchema } from "../src/media_snapshot.ts";

test("replaces creator identifiers consistently across assets and deliveries", () => {
  const input = snapshotRequestSchema.parse({
    snapshotDate: "2026-09-19",
    assets: [{ assetId: "asset-17", creatorId: "patient-creator-42", state: "ready", bytes: 8192 }],
    processingJobs: [{ jobId: "job-9", assetId: "asset-17", state: "completed", outputAssetId: "asset-17-hls" }],
    creatorDeliveries: [{ deliveryId: "delivery-3", creatorId: "patient-creator-42", assetId: "asset-17-hls", state: "delivered" }],
  });

  const snapshot = buildSnapshot(input, "test-only-salt");

  assert.equal(snapshot.assets[0].creatorRef, snapshot.creatorDeliveries[0].creatorRef);
  assert.equal("creatorId" in snapshot.assets[0], false);
  assert.equal(JSON.stringify(snapshot).includes("patient-creator-42"), false);
  assert.equal(snapshot.processingJobs[0].outputAssetId, "asset-17-hls");
});
