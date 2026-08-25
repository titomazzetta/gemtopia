import "server-only";
import { createHmac, randomBytes } from "node:crypto";

/**
 * A minimal, dependency-free OAuth 1.0a client (RFC 5849) with HMAC-SHA1
 * signing — the flavour Discogs speaks.
 *
 * Written by hand rather than pulled from npm on purpose: OAuth 1 signing is
 * ~80 lines, and every OAuth library in the registry is a supply-chain edge
 * with access to the credential it signs with. Discogs also accepts PLAINTEXT
 * signatures (secrets sent literally in the header); we never use that.
 */

export interface OAuthCredentials {
  consumerKey: string;
  consumerSecret: string;
  /** Absent for the request-token step. */
  token?: string;
  tokenSecret?: string;
}

/**
 * RFC 3986 percent-encoding. `encodeURIComponent` leaves ! * ' ( ) alone,
 * which produces signatures that Discogs rejects — hence the fix-up pass.
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Build the signature base string: the exact bytes both sides must agree on.
 * Parameters are sorted by encoded key, then by encoded value.
 */
function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const parsed = new URL(url);

  // Query-string parameters participate in the signature too.
  const all: Array<[string, string]> = [];
  parsed.searchParams.forEach((v, k) => all.push([k, v]));
  for (const [k, v] of Object.entries(params)) all.push([k, v]);

  const normalized = all
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  // The signed URL excludes query and fragment, and is lowercased scheme/host.
  const baseUrl = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}`;

  return [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalized),
  ].join("&");
}

function sign(
  baseString: string,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

/**
 * Produce a complete `Authorization: OAuth ...` header value for one request.
 *
 * @param extra Protocol parameters beyond the standard set —
 *              `oauth_callback` for the request-token step,
 *              `oauth_verifier` for the access-token step.
 */
export function buildAuthHeader(
  method: string,
  url: string,
  creds: OAuthCredentials,
  extra: Record<string, string> = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...extra,
  };

  if (creds.token) oauthParams.oauth_token = creds.token;

  const base = signatureBaseString(method, url, oauthParams);
  oauthParams.oauth_signature = sign(
    base,
    creds.consumerSecret,
    creds.tokenSecret ?? "",
  );

  const header = Object.entries(oauthParams)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(", ");

  return `OAuth ${header}`;
}

/** Parse an `application/x-www-form-urlencoded` OAuth token response. */
export function parseTokenResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = decodeURIComponent(pair.slice(0, idx));
    const v = decodeURIComponent(pair.slice(idx + 1));
    out[k] = v;
  }
  return out;
}
