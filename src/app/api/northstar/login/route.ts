import { NextResponse } from "next/server";
import { northstarRepository, northstarSql, verify } from "@/lib/northstar";
import {
  NORTHSTAR_LEGACY_COOKIE,
  NORTHSTAR_SESSION_COOKIE,
  authenticateNorthstarRequest,
  createNorthstarSession,
  isNorthstarRole,
  isJsonRequest,
  isSameOriginRequest,
  northstarCookieOptions,
  northstarSessionToken,
  revokeNorthstarSession,
  type NorthstarCredentialUser,
} from "@/lib/northstar-auth";

type LoginRateEntry = { count: number; resetAt: number };
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1_000;
const LOGIN_ATTEMPT_LIMIT = 120;
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1_000;
const LOGIN_FAILURE_LIMIT = 20;
const globalWithLoginRateLimits = globalThis as typeof globalThis & {
  __northstarLoginRateLimits?: Map<string, LoginRateEntry>;
};
const loginRateLimits = globalWithLoginRateLimits.__northstarLoginRateLimits ??= new Map();

function loginAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function rateLimitedResponse(entry: LoginRateEntry, message: string) {
  const now = Date.now();
  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1_000));
  const response = NextResponse.json(
    { error: message },
    { status: 429 },
  );
  response.headers.set("retry-after", String(retryAfter));
  return noStore(response);
}

function incrementRateLimit(key: string, windowMs: number) {
  const now = Date.now();
  const previous = loginRateLimits.get(key);
  const next = previous && previous.resetAt > now
    ? { ...previous, count: previous.count + 1 }
    : { count: 1, resetAt: now + windowMs };
  loginRateLimits.set(key, next);
  if (loginRateLimits.size > 5_000) {
    for (const [key, value] of loginRateLimits) {
      if (value.resetAt <= now) loginRateLimits.delete(key);
    }
  }
  return next;
}

function consumeLoginAttempt(address: string) {
  const entry = incrementRateLimit(`attempt:${address}`, LOGIN_ATTEMPT_WINDOW_MS);
  return entry.count > LOGIN_ATTEMPT_LIMIT
    ? rateLimitedResponse(entry, "Too many sign-in attempts. Try again later.")
    : null;
}

function blockedByFailures(address: string) {
  const entry = loginRateLimits.get(`failure:${address}`);
  return entry && entry.resetAt > Date.now() && entry.count >= LOGIN_FAILURE_LIMIT
    ? rateLimitedResponse(entry, "Too many unsuccessful sign-in attempts. Try again later.")
    : null;
}

function recordLoginFailure(address: string) {
  incrementRateLimit(`failure:${address}`, LOGIN_FAILURE_WINDOW_MS);
}

function noStore(response: NextResponse) {
  response.headers.set("cache-control", "no-store");
  return response;
}

function clearAuthenticationCookies(response: NextResponse) {
  response.cookies.set(NORTHSTAR_SESSION_COOKIE, "", {
    ...northstarCookieOptions(),
    maxAge: 0,
  });
  response.cookies.set(NORTHSTAR_LEGACY_COOKIE, "", {
    ...northstarCookieOptions(),
    maxAge: 0,
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const remember = input.remember === true;
  const address = loginAddress(request);
  const rateLimited = consumeLoginAttempt(address) || blockedByFailures(address);
  if (rateLimited) return rateLimited;

  if (!email || email.length > 254 || !password || password.length > 256) {
    recordLoginFailure(address);
    return noStore(
      NextResponse.json({ error: "Invalid email or password" }, { status: 401 }),
    );
  }

  const user = await northstarRepository.get<NorthstarCredentialUser>(
    northstarSql({
      postgres: `SELECT id, email, name, role, password_hash, credential_version
                   FROM users
                  WHERE lower(email) = lower($1) AND active = true`,
      sqlite: `SELECT id, email, name, role, password_hash,
                      NULL AS credential_version
                 FROM users
                WHERE email = ?`,
    }),
    [email],
  );
  if (!user || !isNorthstarRole(user.role) || !(await verify(password, user.password_hash))) {
    recordLoginFailure(address);
    return noStore(
      NextResponse.json({ error: "Invalid email or password" }, { status: 401 }),
    );
  }

  loginRateLimits.delete(`failure:${address}`);

  // Rotate any existing browser session after a successful authentication.
  await revokeNorthstarSession(northstarSessionToken(request));
  let session: Awaited<ReturnType<typeof createNorthstarSession>>;
  try {
    session = await createNorthstarSession(user, request, remember);
  } catch {
    return noStore(
      NextResponse.json(
        { error: "Sign-in is temporarily unavailable. Please try again." },
        { status: 503 },
      ),
    );
  }
  try {
    await northstarRepository.appendAuditEvent({
      recordNumber: user.email,
      actor: { name: user.name, role: user.role, session: session.sessionId },
      action: "Login",
      module: "Authentication",
      recordType: "Session",
      note: "User signed in",
    });
  } catch (error) {
    await revokeNorthstarSession(session.token);
    throw error;
  }

  const response = NextResponse.json({
    id: Number(user.id),
    email: user.email,
    name: user.name,
    role: user.role,
  });
  response.cookies.set(
    NORTHSTAR_SESSION_COOKIE,
    session.token,
    northstarCookieOptions(session.maxAge),
  );
  response.cookies.set(NORTHSTAR_LEGACY_COOKIE, "", {
    ...northstarCookieOptions(),
    maxAge: 0,
  });
  return noStore(response);
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }

  const user = await authenticateNorthstarRequest(request);
  if (user) {
    await northstarRepository.appendAuditEvent({
      recordNumber: user.email,
      actor: user,
      action: "Logout",
      module: "Authentication",
      recordType: "Session",
      note: "User signed out",
    });
  }

  await revokeNorthstarSession(northstarSessionToken(request));
  const response = NextResponse.json({ ok: true });
  clearAuthenticationCookies(response);
  return noStore(response);
}
