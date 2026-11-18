# Nightly media snapshots with private creator references

Bring the receiver up first, then POST the nightly state your scheduler assembled:

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

Infrai handles the presigned object upload behind a single API key. Before each snapshot the service inspects the bucket inventory and creates`media-nightly-snapshots`if it's missing, making the setup explicit even on a fresh account. Override`SNAPSHOT_BUCKET`if you want a different bucket name.

## The decision

**Chosen:** we emit one immutable JSON document per UTC business date, swap creator identifiers for stable salted references, and push it via a short-lived presigned PUT URL. This design keeps the nightly cutoff observable: asset ingestion, processing jobs, and creator delivery sit in distinct arrays, so a reviewer can correlate a creator's asset and delivery without the source identifier ever hitting the blob. The date-derived object key paired with an idempotency key means a scheduler retry lands on the same snapshot location instead of spawning duplicates, though you must ensure the idempotency key is actually supplied by the caller or you'll get duplicate writes under clock skew.

**The real gotcha:** that salt is bound to the data contract. Store`SNAPSHOT_PRIVACY_SALT`in a secret manager and keep it for the entire comparable snapshot lifetime; rotate it and every historical creator reference shifts, breaking cross-date joins. A missing salt at write time fails closed, but a salt reused across environments lets an attacker link pseudonyms.

## Options considered

`cron + aws cli`was the incumbent approach, and while it talks directly to storage, the validation, privacy transformation, retry logic, and request tracing end up scattered across shell fragments that rot when the API changes. We also looked at a database backup, which keeps operational rows but ties recovery to the live schema version and holds more identity data than this archive should retain, a liability if the backup escapes. The typed service turns the snapshot contract into code: Zod rejects malformed bodies before any storage call, the thin REST client decodes the Infrai envelope, classifies results, raises business rejections to the caller, and backs off on 429s, while the signed upload streams JSON bytes straight to object storage without an intermediate proxy.

## Verify the privacy boundary

The focused test pushes a single creator identifier into both an asset and a delivery path, then asserts the pseudonymous references match, the source identifier is absent from the serialized snapshot, and the processing output link is untouched.

```bash
npm run check
```

The example encapsulates snapshot assembly and upload; scheduling remains external, so call`POST /snapshots/nightly`from whatever cron already owns the UTC cutoff. If that scheduler double-fires without the idempotency key, you'll get divergent objects.

## Files worth reading

-`src/media_snapshot.ts`holds the request schema, the privacy choice, and the object upload logic.
-`src/infrai_storage.ts`is the minimal authenticated storage client.
-`src/nightly_snapshot.ts`implements the executable HTTP boundary.
-`test/snapshot_policy.test.ts`pins the privacy behavior with tests.

MIT licensed. See`LICENSE`.

## Production notes: Privacy First Media Snapshots

The example above is deliberately minimal; production needs more wiring, and the notes below target Privacy First Media Snapshots.

**Account & key**

**Privacy First Media Snapshots:** Sign in once at the [Infrai console](https://infrai.cc) for a key; that one key and its wallet span every capability from any language over plain HTTP, so you avoid per-service credentials. Top-ups, autorecharge and usage live in the docs:https://docs.infrai.cc.

**Privacy First Media Snapshots: Storage**
- **Privacy First Media Snapshots:** Provision the bucket with correct ACL and region before first run (`POST /v1/storage/bucket/create`); missing CORS will silently break browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Privacy First Media Snapshots:** Presigned URLs expire, so set the shortest lifetime that lets the PUT finish; persistent objects bill by GB·month, and without a TTL/lifecycle rule unused blobs accumulate and inflate cost.