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

  if (!email || email.length > 254 || !password || password.length > 256) {
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
  if (!user || !isNorthstarRole(user.role) || !verify(password, user.password_hash)) {
    return noStore(
      NextResponse.json({ error: "Invalid email or password" }, { status: 401 }),
    );
  }

  // Rotate any existing browser session after a successful authentication.
  await revokeNorthstarSession(northstarSessionToken(request));
  const session = await createNorthstarSession(user, request, remember);
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
