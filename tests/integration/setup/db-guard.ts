import { PrismaClient } from "@prisma/client";

export interface SanitizedDbTarget {
  host: string;
  port: number;
  database: string;
  schema: string;
  sanitizedUrl: string;
}

/**
 * Validates the test database connection string statically before connecting.
 * Enforces strict fail-closed safety rules:
 * - Must read exclusively from TEST_DATABASE_URL.
 * - Host must be localhost or 127.0.0.1.
 * - Port must be 5433 (local Docker container).
 * - Database must be 'broker_crm_test' (never 'broker_crm' or any other).
 * - Remote cloud targets (Supabase, Neon, Vercel, etc.) are strictly rejected.
 */
export function validateTestDatabaseUrl(urlStr?: string): { url: string; target: SanitizedDbTarget } {
  if (!urlStr || typeof urlStr !== "string" || !urlStr.trim()) {
    throw new Error(
      "[FATAL SAFETY GUARD] TEST_DATABASE_URL is missing. Integration tests must exclusively read from TEST_DATABASE_URL. Silent fallback to DATABASE_URL or DIRECT_URL is strictly forbidden."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new Error("[FATAL SAFETY GUARD] Malformed TEST_DATABASE_URL string.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const port = parseInt(parsed.port, 10);
  const pathname = parsed.pathname.replace(/^\//, "");
  const schema = parsed.searchParams.get("schema") || "public";

  // 1. Host check: only local host allowed
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(
      `[FATAL SAFETY GUARD] Integration tests are restricted to local Docker PostgreSQL (localhost or 127.0.0.1). Detected unauthorized host: '${hostname}'.`
    );
  }

  // 2. Port check: local docker port 5433
  if (port !== 5433) {
    throw new Error(
      `[FATAL SAFETY GUARD] Expected local Docker PostgreSQL on port 5433. Detected unauthorized port: ${port}.`
    );
  }

  // 3. Database name check: strictly broker_crm_test
  if (pathname !== "broker_crm_test") {
    throw new Error(
      `[FATAL SAFETY GUARD] Target database must strictly equal 'broker_crm_test'. Detected unauthorized database: '${pathname}'. Development database 'broker_crm' and all other targets are strictly forbidden.`
    );
  }

  // 4. Cloud / remote host rejection
  const forbiddenKeywords = ["supabase", "neon", "vercel", "pooler", "aws", "azure", "rds"];
  for (const kw of forbiddenKeywords) {
    if (urlStr.toLowerCase().includes(kw)) {
      throw new Error(
        `[FATAL SAFETY GUARD] Forbidden cloud/remote keyword detected in database URL: '${kw}'. Remote and production databases are strictly prohibited.`
      );
    }
  }

  const sanitizedUrl = `postgresql://***@${hostname}:${port}/${pathname}?schema=${schema}`;

  return {
    url: urlStr.trim(),
    target: {
      host: hostname,
      port,
      database: pathname,
      schema,
      sanitizedUrl,
    },
  };
}

/**
 * Executes a runtime SQL handshake to verify the active connected database.
 * Confirms that the PostgreSQL server itself reports current_database() === 'broker_crm_test'.
 */
export async function assertLiveTestDatabaseSafety(prisma: PrismaClient): Promise<SanitizedDbTarget> {
  const { target } = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);

  const result = await prisma.$queryRawUnsafe<
    Array<{
      current_database: string;
      inet_server_addr: string | null;
      inet_server_port: number | null;
    }>
  >("SELECT current_database(), inet_server_addr(), inet_server_port()");

  if (!result || result.length === 0) {
    throw new Error("[FATAL SAFETY GUARD] Failed to retrieve PostgreSQL handshake metadata.");
  }

  const row = result[0];
  if (row.current_database !== "broker_crm_test") {
    throw new Error(
      `[FATAL SAFETY GUARD] Runtime database mismatch! Expected 'broker_crm_test', but connected to '${row.current_database}'. Aborting immediately to prevent unauthorized data mutation.`
    );
  }

  return target;
}
