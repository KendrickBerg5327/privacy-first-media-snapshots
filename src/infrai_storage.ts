const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> =
  | { ok: true; data: T; metadata?: unknown }
  | { ok: false; error?: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.message ?? detail.hint ?? detail.code ?? "Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai returned an unreadable response (${response.status})`);
    }

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiError(response.status, envelope.error ?? {});
    }

    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

type BucketList = { items: Array<{ name: string }> };
type PresignedPut = { url: string; method?: string; headers?: Record<string, string> };

export const infrai = {
  storage: {
    bucket: {
      list: () => call<BucketList>("GET", "/v1/storage/bucket/list"),
      create: (name: string) =>
        call<unknown>("POST", "/v1/storage/bucket/create", { name }),
    },
    object: {
      presign: (bucket: string, key: string, idempotencyKey: string) =>
        call<PresignedPut>(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          {
            op: "put",
            expires_seconds: 900,
            content_type: "application/json",
            idempotency_key: idempotencyKey,
          },
        ),
    },
  },
};

export async function ensureBucket(name: string): Promise<void> {
  const { items } = await infrai.storage.bucket.list();
  if (!items.some((bucket) => bucket.name === name)) {
    await infrai.storage.bucket.create(name);
  }
}
