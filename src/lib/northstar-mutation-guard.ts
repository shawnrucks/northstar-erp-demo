import { createHash } from "node:crypto";

import type { NorthstarUser } from "@/lib/northstar-auth";

type RateEntry = { count: number; resetAt: number };
type ResponseSnapshot = {
  body: ArrayBuffer;
  headers: Array<[string, string]>;
  status: number;
};
type IdempotencyEntry = {
  expiresAt: number;
  payloadHash: string;
  result: Promise<ResponseSnapshot>;
};

const MUTATION_WINDOW_MS = 10 * 60 * 1_000;
const MUTATIONS_PER_SESSION = 120;
const MUTATIONS_PER_IP = 300;
const IDEMPOTENCY_TTL_MS = 30 * 60 * 1_000;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const state = globalThis as typeof globalThis & {
  __northstarMutationRates?: Map<string, RateEntry>;
  __northstarIdempotency?: Map<string, IdempotencyEntry>;
};
const mutationRates = state.__northstarMutationRates ??= new Map();
const idempotencyEntries = state.__northstarIdempotency ??= new Map();

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function consume(key: string) {
  const now = Date.now();
  const previous = mutationRates.get(key);
  const next = previous && previous.resetAt > now
    ? { ...previous, count: previous.count + 1 }
    : { count: 1, resetAt: now + MUTATION_WINDOW_MS };
  mutationRates.set(key, next);
  return next;
}

function json(body: Record<string, unknown>, status: number, retryAfter?: number) {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-type": "application/json",
  };
  if (retryAfter) headers["retry-after"] = String(retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

function cleanup(now: number) {
  if (mutationRates.size > 5_000) {
    for (const [key, entry] of mutationRates) {
      if (entry.resetAt <= now) mutationRates.delete(key);
    }
  }
  if (idempotencyEntries.size > 10_000) {
    for (const [key, entry] of idempotencyEntries) {
      if (entry.expiresAt <= now) idempotencyEntries.delete(key);
    }
  }
}

function responseFromSnapshot(snapshot: ResponseSnapshot, replayed: boolean) {
  const headers = new Headers(snapshot.headers);
  headers.set("cache-control", "no-store");
  if (replayed) headers.set("idempotency-replayed", "true");
  return new Response(snapshot.body.slice(0), { status: snapshot.status, headers });
}

export async function executeNorthstarMutation(
  request: Request,
  user: Pick<NorthstarUser, "session">,
  scope: string,
  operation: () => Promise<Response>,
) {
  const now = Date.now();
  cleanup(now);
  const address = clientAddress(request);
  const sessionRate = consume(`session:${user.session}`);
  const ipRate = consume(`ip:${address}`);
  const blocked = sessionRate.count > MUTATIONS_PER_SESSION ? sessionRate
    : ipRate.count > MUTATIONS_PER_IP ? ipRate
      : null;
  if (blocked) {
    const retryAfter = Math.max(1, Math.ceil((blocked.resetAt - now) / 1_000));
    return json(
      { error: "Too many changes were requested. Try again later." },
      429,
      retryAfter,
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    return json({ error: "A valid idempotency key is required." }, 400);
  }
  const payloadHash = createHash("sha256").update(await request.clone().text()).digest("hex");
  const cacheKey = `${scope}:${user.session}:${idempotencyKey}`;
  const existing = idempotencyEntries.get(cacheKey);
  if (existing && existing.expiresAt > now) {
    if (existing.payloadHash !== payloadHash) {
      return json({ error: "That idempotency key was already used for different content." }, 409);
    }
    return responseFromSnapshot(await existing.result, true);
  }

  const result = (async (): Promise<ResponseSnapshot> => {
    const response = await operation();
    return {
      body: await response.arrayBuffer(),
      headers: Array.from(response.headers.entries()),
      status: response.status,
    };
  })();
  idempotencyEntries.set(cacheKey, {
    expiresAt: now + IDEMPOTENCY_TTL_MS,
    payloadHash,
    result,
  });

  try {
    const snapshot = await result;
    if (snapshot.status >= 500) idempotencyEntries.delete(cacheKey);
    return responseFromSnapshot(snapshot, false);
  } catch (error) {
    idempotencyEntries.delete(cacheKey);
    throw error;
  }
}
