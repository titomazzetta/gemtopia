import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

/**
 * Postgres access.
 *
 * One module-level pool, reused across warm serverless invocations. `max` is
 * deliberately tiny: each Vercel isolate handles one request at a time, and
 * Neon's own pooler (the `-pooler` host in the connection string) is what
 * actually multiplexes across isolates. A large pool here just burns Neon's
 * connection budget.
 *
 * Every query in this app goes through `query()` or `tx()`. There is no string
 * concatenation of SQL anywhere in the codebase — `$1`-style placeholders
 * only, which makes SQL injection structurally impossible rather than
 * merely avoided by convention.
 */

declare global {
  var __playtopiaPool: Pool | undefined;
}

function makePool(): Pool {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    // Neon and every other managed provider require TLS. Local development
    // against a plain Postgres on localhost is the only exception.
    ssl: env.DATABASE_URL.includes("localhost") ||
      env.DATABASE_URL.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: true },
  });

  // A pool that emits an unhandled 'error' event will crash the process.
  pool.on("error", (error) => {
    console.error("[db] idle client error", error.message);
  });

  return pool;
}

function getPool(): Pool {
  if (env.NODE_ENV === "production") {
    if (!globalThis.__playtopiaPool) {
      globalThis.__playtopiaPool = makePool();
    }
    return globalThis.__playtopiaPool;
  }
  // In dev, hot reload would leak a pool per edit without the global.
  if (!globalThis.__playtopiaPool) {
    globalThis.__playtopiaPool = makePool();
  }
  return globalThis.__playtopiaPool;
}

/** Parameterised query. `text` must never be built by concatenation. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Parameterised query expecting at most one row. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a function inside a transaction. Rolls back on any throw.
 * Used wherever a write spans more than one statement — reordering a playlist,
 * replacing its items, importing a batch.
 */
export async function tx<T>(
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already dead; the pool will discard it */
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Liveness probe used by the migration script and by tests. */
export async function ping(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
