import "server-only";

/**
 * In-process sliding-window rate limiter.
 *
 * Scope and honesty about it: Vercel runs each function in its own isolate, so
 * this bounds abuse *per instance*, not globally. It is a cheap first line of
 * defence that costs no external dependency and no round trip. A deployment
 * expecting real hostile traffic should put Vercel WAF / Upstash Redis in
 * front of it — see THREAT_MODEL.md "Residual risks".
 *
 * It exists mainly to stop one logged-in client from burning the whole
 * Discogs 60-req/min budget and getting the app's IP throttled for everyone.
 */

interface Window {
  hits: number[];
}

const buckets = new Map<string, Window>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetSeconds: number;
}

export function rateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Crude cardinality cap so a rotating-key attacker cannot grow the map
  // without bound. Evicting the oldest insertions is fine here.
  if (buckets.size > MAX_BUCKETS) {
    const keys = [...buckets.keys()].slice(0, MAX_BUCKETS / 2);
    for (const k of keys) buckets.delete(k);
  }

  let bucket = buckets.get(identifier);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(identifier, bucket);
  }

  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      resetSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);
  return {
    ok: true,
    remaining: limit - bucket.hits.length,
    resetSeconds: Math.ceil(windowMs / 1000),
  };
}

/**
 * Identify the caller for limiting purposes.
 * Prefers the authenticated username; falls back to the Vercel-provided client
 * IP. We never trust a raw `X-Forwarded-For` we did not put there ourselves.
 */
/**
 * The key a rate-limit bucket is counted under.
 *
 * `scope` is required, and that is the point. Buckets are keyed by this string
 * alone, so two routes passing the same identifier share one counter — which
 * meant every route using a bare caller id drew on the same allowance, and the
 * smallest limit any of them declared silently became the limit for all of
 * them. A minute of BPM writes from the detector (120/min, legitimately) would
 * exhaust the 20/min a share link is allowed and lock the user out of a
 * feature they had not touched.
 *
 * Making the scope an argument rather than a convention means the compiler
 * finds every call site, and a new route cannot forget.
 */
export function callerId(
  request: Request,
  scope: string,
  username?: string,
): string {
  if (username) return `${scope}:u:${username}`;
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${scope}:ip:${ip}`;
}
