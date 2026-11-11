import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError } from "./infrai_storage.ts";
import { snapshotRequestSchema, storeNightlySnapshot } from "./media_snapshot.ts";

const port = Number(process.env.PORT ?? 3000);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/snapshots/nightly") {
    json(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = snapshotRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const stored = await storeNightlySnapshot(input);
    json(response, 201, { ok: true, snapshot: stored });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      json(response, 400, { ok: false, error: "invalid_snapshot_request" });
      return;
    }
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      json(response, error.status, { ok: false, error: error.detail });
      return;
    }
    console.error(error);
    json(response, 500, { ok: false, error: "snapshot_failed" });
  }
}).listen(port, () => {
  console.log(`Nightly snapshot service listening on http://localhost:${port}`);
});
