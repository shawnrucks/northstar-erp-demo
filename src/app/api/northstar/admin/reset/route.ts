import { NextResponse } from "next/server";

import {
  getNorthstarDemoResetStatus,
  NorthstarDemoResetError,
  resetNorthstarDemo,
} from "@/lib/northstar-demo-reset";
import {
  authenticateNorthstarRequest,
  isJsonRequest,
  isSameOriginRequest,
  NORTHSTAR_SESSION_COOKIE,
  northstarCookieOptions,
} from "@/lib/northstar-auth";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200, retryAfterSeconds?: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("cache-control", "no-store");
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    response.headers.set("retry-after", String(retryAfterSeconds));
  }
  return response;
}

async function admin(request: Request) {
  const user = await authenticateNorthstarRequest(request);
  if (!user) return { response: json({ error: "Authentication is required." }, 401) };
  if (user.role !== "ADMIN") {
    return { response: json({ error: "Administrator access is required." }, 403) };
  }
  return { user };
}

export async function GET(request: Request) {
  const authorization = await admin(request);
  if ("response" in authorization) return authorization.response;

  try {
    const status = await getNorthstarDemoResetStatus();
    return json(status);
  } catch {
    return json({ error: "Demo reset status is temporarily unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  const authorization = await admin(request);
  if ("response" in authorization) return authorization.response;
  if (!isSameOriginRequest(request)) {
    return json({ error: "The request origin was not accepted." }, 403);
  }
  if (!isJsonRequest(request)) {
    return json({ error: "A JSON request body is required." }, 415);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "The request body is not valid JSON." }, 400);
  }

  const idempotencyKey = request.headers.get("idempotency-key") || body.idempotencyKey;
  if (typeof idempotencyKey !== "string") {
    return json({ error: "An idempotency key is required." }, 400);
  }

  try {
    const result = await resetNorthstarDemo({
      idempotencyKey,
      actor: authorization.user,
    });
    const response = json({ ok: true, ...result });
    if (!result.replayed) {
      response.cookies.set(NORTHSTAR_SESSION_COOKIE, "", {
        ...northstarCookieOptions(0),
        expires: new Date(0),
      });
    }
    return response;
  } catch (error) {
    if (error instanceof NorthstarDemoResetError) {
      const messages: Record<string, string> = {
        BUSY: "Another demo reset is already running.",
        COOLDOWN: "The demo was reset recently. Try again after the cooldown.",
        IDEMPOTENCY_IN_PROGRESS: "This reset request is still running.",
        IDEMPOTENCY_FAILED: "This reset request previously failed. Use a new idempotency key.",
        INVALID_IDEMPOTENCY_KEY: "The idempotency key is not valid.",
        TEMPLATES_UNAVAILABLE: "Canonical demo data is not available.",
        RESET_FAILED: "The demo could not be reset safely.",
      };
      return json(
        { error: messages[error.code] || "The demo reset request was not accepted." },
        error.status,
        error.retryAfterSeconds,
      );
    }
    return json({ error: "The demo could not be reset safely." }, 500);
  }
}
