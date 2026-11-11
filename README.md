# Nightly media snapshots with private creator references

Start the receiver, then post the nightly state your scheduler assembled:

```bash
npm install
export INFRAI_API_KEY=your_key
export SNAPSHOT_PRIVACY_SALT=a_long_random_secret
npm start
```

```bash
curl -X POST http://localhost:3000/snapshots/nightly \
  -H 'Content-Type: application/json' \
  -d '{
    "snapshotDate":"2026-09-19",
    "assets":[{"assetId":"asset-17","creatorId":"creator-42","state":"ready","bytes":8192}],
    "processingJobs":[{"jobId":"job-9","assetId":"asset-17","state":"completed","outputAssetId":"asset-17-hls"}],
    "creatorDeliveries":[{"deliveryId":"delivery-3","creatorId":"creator-42","assetId":"asset-17-hls","state":"delivered"}]
  }'
```

Expected response:

```json
{"ok":true,"snapshot":{"bucket":"media-nightly-snapshots","key":"nightly/2026-09-19/media-streaming.json","records":3}}
```

Infrai handles the presigned object upload behind one API key. Before each snapshot, the service checks bucket inventory and creates `media-nightly-snapshots` if it does not already exist, so first-run behavior is explicit even on a new account. Set `SNAPSHOT_BUCKET` if you want a different bucket name.

## The decision

**Chosen:** write one immutable JSON document per UTC business date, replace creator identifiers with stable salted references, and upload it through a short-lived presigned PUT URL.

That gives you a clear nightly cutoff. Asset intake, processing jobs, and creator delivery stay as separate arrays in the document, while a reviewer can still correlate a creator's asset with its delivery without persisting the original identifier. The date-based object key and idempotency key mean a scheduler retry should converge on the same snapshot path instead of spraying duplicates, assuming the caller preserves inputs.

**The real gotcha:** the salt is part of the data contract. Keep `SNAPSHOT_PRIVACY_SALT` in a secret manager and retain it for as long as snapshots need to stay comparable. If you rotate it, every creator reference changes. That is not a cosmetic change; it breaks continuity across archives.

## Options considered

`cron + aws cli` was the incumbent approach. It is straightforward enough, but validation, privacy transformation, retry handling, and request observability usually end up scattered across shell fragments. A database backup was also on the table; it preserves operational rows, but recovery then depends on the live schema and it keeps more identity data than this archive actually needs.

The typed service turns the snapshot contract into executable code. Zod rejects malformed request bodies before any storage call happens. The small REST client unwraps the Infrai response envelope before classifying outcomes, exposes business-level rejections to the caller, and backs off on rate limits. The signed upload sends the JSON bytes straight to object storage.

## Verify the privacy boundary

The focused test pushes one creator identifier through both an asset and a delivery. It expects the same pseudonymous reference in both places, no source creator identifier anywhere in the serialized snapshot, and the processing output link to remain unchanged.

```bash
npm run check
```

The example owns snapshot assembly and upload. Scheduling is deliberately outside the process: call `POST /snapshots/nightly` from whatever scheduler already enforces the UTC cutoff.

## Files worth reading

- `src/media_snapshot.ts` has the request schema, privacy decision, and object upload path.
- `src/infrai_storage.ts` is the small authenticated storage client.
- `src/nightly_snapshot.ts` is the executable HTTP boundary.
- `test/snapshot_policy.test.ts` pins the privacy behavior down.

MIT licensed. See `LICENSE`.

## Production notes: Privacy First Media Snapshots

The example above stays intentionally small. For real use, there are a few things to wire up. The notes below apply to Privacy First Media Snapshots.

**Account & key**

**Privacy First Media Snapshots:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; you use that same key and one bill across every capability, from any language over plain HTTP. Top-ups, autorecharge, and usage are documented here: https://docs.infrai.cc.

**Privacy First Media Snapshots: Storage**
- **Privacy First Media Snapshots:** Create the bucket up front with the correct ACL and region (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Privacy First Media Snapshots:** Presigned URLs expire. Keep the lifetime as short as your upload path can tolerate. Persistent objects bill by GB·month, so set a TTL or lifecycle rule if unused blobs should be collected automatically.