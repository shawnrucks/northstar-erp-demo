import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { northstarRepository, northstarSql } from "@/lib/northstar";

export const NORTHSTAR_SESSION_COOKIE = "ns_session";
export const NORTHSTAR_LEGACY_COOKIE = "ns_user";

export const NORTHSTAR_ROLES = [
  "ADMIN",
  "SALES_COORDINATOR",
  "BUYER",
  "PRODUCTION_PLANNER",
  "OPERATIONS_ANALYST",
  "ACCOUNTS_PAYABLE",
  "QUALITY_SPECIALIST",
] as const;

export type NorthstarRole = (typeof NORTHSTAR_ROLES)[number];

export type NorthstarUser = {
  id: number;
  email: string;
  name: string;
  role: NorthstarRole;
  /** A non-secret identifier used only to correlate audit events. */
  session: string;
};

export type NorthstarCredentialUser = {
  id: number | string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  credential_version?: number | string | null;
};

type SessionRow = NorthstarCredentialUser & {
  session_credential_version: number | string;
  user_credential_version: number | string | null;
  last_seen_epoch: number | string;
};

const SHORT_SESSION_SECONDS = 12 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let sqliteSessionTableReady: Promise<void> | null = null;

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function isNorthstarRole(value: string): value is NorthstarRole {
  return (NORTHSTAR_ROLES as readonly string[]).includes(value);
}

async function ensureSessionTable() {
  if (northstarRepository.provider === "postgres") return;
  if (!sqliteSessionTableReady) {
    sqliteSessionTableReady = northstarRepository
      .transaction(async (transaction) => {
        await transaction.run(`CREATE TABLE IF NOT EXISTS northstar_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          credential_version TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          user_agent TEXT
        )`);
        await transaction.run(
          "CREATE INDEX IF NOT EXISTS northstar_sessions_expiry ON northstar_sessions(expires_at)",
        );
      })
      .catch((error) => {
        sqliteSessionTableReady = null;
        throw error;
      });
  }
  await sqliteSessionTableReady;
}

function sessionCookieFromHeader(request: Request) {
  const raw = request.headers.get("cookie");
  if (!raw) return null;

  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== NORTHSTAR_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

async function invalidateSession(tokenHash: string) {
  await northstarRepository.run(
    northstarSql({
      postgres: "UPDATE northstar_sessions SET revoked_at = now() WHERE token_hash = $1",
      sqlite: "DELETE FROM northstar_sessions WHERE token_hash = ?",
    }),
    [tokenHash],
  );
}

async function resolveNorthstarSession(
  token: string | null | undefined,
): Promise<NorthstarUser | null> {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  await ensureSessionTable();

  const currentTime = nowInSeconds();
  const tokenHash = sha256(token);
  const row = await northstarRepository.get<SessionRow>(
    northstarSql({
      postgres: `SELECT s.credential_version AS session_credential_version,
                        extract(epoch FROM s.last_seen_at)::bigint AS last_seen_epoch,
                        u.id, u.email, u.name, u.role, u.password_hash,
                        u.credential_version AS user_credential_version
                   FROM northstar_sessions s
                   JOIN users u ON u.id = s.user_id
                  WHERE s.token_hash = $1
                    AND s.expires_at > now()
                    AND s.revoked_at IS NULL
                    AND u.active = true`,
      sqlite: `SELECT s.credential_version AS session_credential_version,
                      s.last_seen_at AS last_seen_epoch,
                      u.id, u.email, u.name, u.role, u.password_hash,
                      NULL AS user_credential_version
                 FROM northstar_sessions s
                 JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?`,
    }),
    northstarRepository.provider === "postgres" ? [tokenHash] : [tokenHash, currentTime],
  );

  if (!row) return null;
  const currentCredentialVersion =
    row.user_credential_version == null
      ? sha256(row.password_hash)
      : String(row.user_credential_version);
  if (
    String(row.session_credential_version) !== currentCredentialVersion ||
    !isNorthstarRole(row.role)
  ) {
    await invalidateSession(tokenHash);
    return null;
  }

  if (currentTime - Number(row.last_seen_epoch) >= 5 * 60) {
    await northstarRepository.run(
      northstarSql({
        postgres: "UPDATE northstar_sessions SET last_seen_at = now() WHERE token_hash = $1",
        sqlite: "UPDATE northstar_sessions SET last_seen_at = ? WHERE token_hash = ?",
      }),
      northstarRepository.provider === "postgres"
        ? [tokenHash]
        : [currentTime, tokenHash],
    );
  }

  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    role: row.role,
    session: tokenHash.slice(0, 16),
  };
}

export async function createNorthstarSession(
  user: NorthstarCredentialUser,
  request: Request,
  remember = false,
) {
  await ensureSessionTable();
  const currentTime = nowInSeconds();
  const lifetime = remember ? REMEMBERED_SESSION_SECONDS : SHORT_SESSION_SECONDS;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const credentialVersion =
    northstarRepository.provider === "postgres"
      ? Number(user.credential_version)
      : sha256(user.password_hash);
  if (
    northstarRepository.provider === "postgres" &&
    (!Number.isInteger(credentialVersion) || Number(credentialVersion) < 1)
  ) {
    throw new Error("The account has an invalid credential version.");
  }

  await northstarRepository.transaction(async (transaction) => {
    if (transaction.provider === "postgres") {
      await transaction.run(
        `DELETE FROM northstar_sessions
          WHERE expires_at <= now()
             OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`,
      );
    } else {
      await transaction.run("DELETE FROM northstar_sessions WHERE expires_at <= ?", [currentTime]);
    }
    await transaction.run(
      northstarSql({
        postgres: `INSERT INTO northstar_sessions
          (token_hash, user_id, credential_version, created_at, expires_at, last_seen_at, user_agent)
          VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($5), to_timestamp($6), $7)`,
        sqlite: `INSERT INTO northstar_sessions
          (token_hash, user_id, credential_version, created_at, expires_at, last_seen_at, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      }),
      [
        tokenHash,
        user.id,
        credentialVersion,
        currentTime,
        currentTime + lifetime,
        currentTime,
        (request.headers.get("user-agent") || "").slice(0, 255),
      ],
    );
  });

  return {
    token,
    expiresAt: currentTime + lifetime,
    maxAge: remember ? lifetime : undefined,
    sessionId: tokenHash.slice(0, 16),
  };
}

export async function revokeNorthstarSession(token: string | null | undefined) {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return;
  await ensureSessionTable();
  await invalidateSession(sha256(token));
}

export async function authenticateNorthstarRequest(request: Request) {
  return resolveNorthstarSession(sessionCookieFromHeader(request));
}

export async function getCurrentNorthstarUser() {
  const token = (await cookies()).get(NORTHSTAR_SESSION_COOKIE)?.value;
  return resolveNorthstarSession(token);
}

export function northstarSessionToken(request: Request) {
  return sessionCookieFromHeader(request);
}

export function northstarCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export function isSameOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return origin !== "null";

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const host = request.headers.get("host") || forwardedHost || new URL(request.url).host;
  if (originUrl.host.toLowerCase() !== host.toLowerCase()) return false;

  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (forwardedProtocol && originUrl.protocol !== `${forwardedProtocol}:`) return false;
  return true;
}

export function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.toLowerCase().startsWith("application/json") ?? false;
}
