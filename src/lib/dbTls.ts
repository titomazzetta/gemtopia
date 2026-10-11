/**
 * How the app connects to Postgres: TLS policy decided here, in code, not by
 * whatever a connection string happens to say.
 *
 * Three things this fixes, all found by reading rather than by an incident:
 *
 *  1. The old check was `DATABASE_URL.includes("localhost")`. A substring
 *     test on a URL: a host like `localhost.example.com`, or a password that
 *     happened to contain "127.0.0.1", would have switched TLS off for a
 *     remote database. The host is now parsed and compared exactly.
 *
 *  2. node-postgres merges SSL settings parsed from the URL *over* the ones
 *     passed in code. So `?sslmode=disable` (or `no-verify`, or
 *     `uselibpqcompat=true&sslmode=require`) in a pasted connection string
 *     silently beat `ssl: { rejectUnauthorized: true }`, and pg v9 is
 *     documented to weaken plain `sslmode=require` to "encrypt but don't
 *     check the certificate". The SSL parameters are now stripped from the
 *     string, and the policy below is the only one that applies.
 *
 *  3. Neon's connection strings end in `channel_binding=require`, and
 *     node-postgres ignores that parameter: it binds only when
 *     `enableChannelBinding` is set in code. So the URL asked for channel
 *     binding and the login never used it. It's set here now.
 *
 * The policy: any database that isn't on this machine gets TLS 1.2 or newer
 * with the server certificate verified against the system's trusted CAs and
 * its hostname checked — no way to turn that off from configuration — plus
 * SCRAM channel binding (SCRAM-SHA-256-PLUS), which ties the password
 * exchange to that TLS session, so even a man-in-the-middle holding a
 * mis-issued certificate couldn't relay the login. node-postgres falls back
 * to plain SCRAM only if the server doesn't offer binding, and says so in the
 * handshake, so a middlebox that strips the offer is detected by the server.
 *
 * A loopback host (CI's service container, a local Postgres) gets plaintext:
 * the connection never leaves the machine, and there is no certificate to
 * verify.
 *
 * Pure, so scripts/test-db-tls.mjs can check every case.
 */

export interface PgConnectionOptions {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true; minVersion: "TLSv1.2" };
  enableChannelBinding: boolean;
}

/** Connection-string parameters that would otherwise override the policy. */
const SSL_PARAMS = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation",
  "uselibpqcompat",
]);

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Strip the SSL parameters without re-encoding the rest: rebuilding through
 * URLSearchParams would turn `%20` into `+`, which pg does not decode, and
 * quietly break an `options=` parameter.
 */
function withoutSslParams(raw: string): string {
  const q = raw.indexOf("?");
  if (q === -1) return raw;
  const hash = raw.indexOf("#", q);
  const base = raw.slice(0, q);
  const search = raw.slice(q + 1, hash === -1 ? undefined : hash);
  const fragment = hash === -1 ? "" : raw.slice(hash);
  const kept = search
    .split("&")
    .filter((pair) => pair && !SSL_PARAMS.has(decodeURIComponent(pair.split("=")[0] ?? "").toLowerCase()));
  return kept.length > 0 ? `${base}?${kept.join("&")}${fragment}` : `${base}${fragment}`;
}

export function pgConnectionOptions(databaseUrl: string): PgConnectionOptions {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a postgres:// connection string");
  }

  // pg lets ?host= override the authority, and a Unix socket path is local.
  const queryHost = url.searchParams.get("host");
  const host = queryHost ?? url.hostname;
  const local = host.startsWith("/") || (host !== "" && isLoopbackHost(host));
  const connectionString = withoutSslParams(databaseUrl);

  if (local) return { connectionString, ssl: false, enableChannelBinding: false };
  if (host === "") throw new Error("DATABASE_URL has no host");
  return {
    connectionString,
    ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    enableChannelBinding: true,
  };
}
