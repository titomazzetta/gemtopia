#!/usr/bin/env node
/**
 * Applies db/schema.sql.
 *
 * The schema is written to be idempotent (every statement is CREATE ... IF NOT
 * EXISTS), so this is safe to run on every deploy. There is no versioned
 * migration table yet because the schema has never been destructively changed;
 * the moment a column needs dropping or retyping, this gets replaced with a
 * numbered-migration runner rather than being made cleverer.
 *
 *   npm run db:migrate
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "db", "schema.sql");

// Whether DATABASE_URL was set in the environment, before .env.local can fill it.
const fromCommandLine = Boolean(process.env.DATABASE_URL);

// Load .env.local for local runs. Vercel injects env vars directly.
try {
  const envFile = readFileSync(join(here, "..", ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env.local — fine in CI and on Vercel */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let target;
try {
  target = new URL(url);
} catch {
  console.error("DATABASE_URL is not a valid connection string.");
  process.exit(1);
}

const isLocal = target.hostname === "localhost" || target.hostname === "127.0.0.1";

/*
 * Say which database this is about to change, before changing it — host and
 * database name only, never the credentials. Development and production can
 * be separate Neon projects, and `npm run db:migrate` reads .env.local, so
 * without this line it will happily migrate the development database while
 * you believe you are preparing production. That exact mix-up took the live
 * site down for ten minutes on 2026-09-28.
 */
console.log(`Migrating ${target.hostname}${target.pathname}`);
console.log(
  fromCommandLine
    ? "  (DATABASE_URL set in the environment — command line or CI)"
    : "  (DATABASE_URL from .env.local — your development database, if production has its own)",
);

const client = new pg.Client({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: true },
});

try {
  await client.connect();
  const sql = readFileSync(schemaPath, "utf8");
  await client.query(sql);

  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );

  console.log("Schema applied. Tables:");
  for (const row of rows) console.log("  -", row.table_name);
} catch (error) {
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
