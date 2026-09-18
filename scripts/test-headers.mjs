/**
 * Security header tests.
 *
 *   node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/test-headers.mjs
 *
 * Written after `Permissions-Policy: display-capture=(), microphone=()` shipped
 * and disabled BPM detection on every deployment. Both of its modes failed, the
 * browser reported only "audio capture was not allowed" — the same DOMException
 * a user gets for pressing Cancel — and nothing in the client code was wrong.
 *
 * The lesson generalises past this one header: hardening that removes a
 * capability the product depends on is invisible in review, because the diff
 * that breaks it looks exactly like the diff that secures it. So the policy is
 * asserted in both directions — the features we need are granted, and the ones
 * we don't are still denied. A future tightening pass has to change a test on
 * its way through, which is the point.
 */
import assert from "node:assert/strict";
import { securityHeaders } from "../next.config.ts";

let ran = 0;
let failed = 0;

function check(name, fn) {
  ran += 1;
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}

const header = (key) => securityHeaders.find((h) => h.key === key)?.value;

const permissions = () => {
  const raw = header("Permissions-Policy");
  assert.ok(raw, "Permissions-Policy header is missing entirely");
  return Object.fromEntries(
    raw.split(",").map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return [name, rest.join("=")];
    }),
  );
};

/* -- the features the app actually needs --------------------------------- */

check("display-capture is granted to self — BPM detection depends on it", () => {
  assert.equal(
    permissions()["display-capture"],
    "(self)",
    "tab-audio capture is the primary BPM detection path; `()` disables it",
  );
});

check("microphone is granted to self — the Safari/Firefox fallback", () => {
  assert.equal(
    permissions()["microphone"],
    "(self)",
    "mic capture is the only BPM path in browsers without tab capture",
  );
});

check("autoplay is granted to self — the player advances between tracks", () => {
  assert.equal(permissions()["autoplay"], "(self)");
});

/* -- the features it does not, which must stay shut ----------------------- */

for (const feature of [
  "camera",
  "geolocation",
  "payment",
  "usb",
  "accelerometer",
  "gyroscope",
  "magnetometer",
  "interest-cohort",
]) {
  check(`${feature} stays denied to everyone`, () => {
    assert.equal(
      permissions()[feature],
      "()",
      `${feature} is not used by this app and must not be granted`,
    );
  });
}

check("no feature is granted to * ", () => {
  for (const [feature, allowlist] of Object.entries(permissions())) {
    assert.notEqual(allowlist, "*", `${feature} is granted to every origin`);
  }
});

check("nothing grants a third-party origin", () => {
  // (self) and () only. A named origin here would hand a capability to an
  // embedded frame — notably the YouTube player, which must never get one.
  for (const [feature, allowlist] of Object.entries(permissions())) {
    assert.ok(
      allowlist === "()" || allowlist === "(self)",
      `${feature} has an unexpected allowlist: ${allowlist}`,
    );
  }
});

/* -- the rest of the header set ------------------------------------------ */

check("HSTS is long-lived and covers subdomains", () => {
  const value = header("Strict-Transport-Security");
  assert.match(value, /max-age=(\d+)/);
  assert.ok(Number(/max-age=(\d+)/.exec(value)[1]) >= 31536000, "max-age under a year");
  assert.match(value, /includeSubDomains/);
});

check("MIME sniffing is off", () => {
  assert.equal(header("X-Content-Type-Options"), "nosniff");
});

check("framing is denied", () => {
  assert.equal(header("X-Frame-Options"), "DENY");
});

check("referrers identify the origin, and nothing more", () => {
  /*
   * NOT `no-referrer`, and this test exists to stop it going back.
   *
   * Under `no-referrer` the YouTube iframe gets no Referer header, so YouTube
   * cannot identify the embedding site and refuses to play — error 153/154.
   * Chrome tolerates it; Safari does not, on desktop or phone. It cost a day
   * of chasing a browser bug that was ours.
   *
   * `strict-origin-when-cross-origin` sends the origin only: no path, no
   * query. A share token lives in a path, so it still cannot leak.
   */
  assert.equal(header("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.notEqual(
    header("Referrer-Policy"),
    "no-referrer",
    "no-referrer stops YouTube playing in Safari — see next.config.ts",
  );
});

check("CSP is not set statically — it carries a per-request nonce", () => {
  // A static CSP here would mean a static nonce, which is no nonce at all.
  assert.equal(
    header("Content-Security-Policy"),
    undefined,
    "CSP must come from proxy.ts so every response gets a fresh nonce",
  );
});

check("COEP is absent, deliberately", () => {
  // The YouTube iframe sends no CORP header and would be blocked outright.
  assert.equal(header("Cross-Origin-Embedder-Policy"), undefined);
});

check("every header has a non-empty value", () => {
  for (const { key, value } of securityHeaders) {
    assert.ok(typeof value === "string" && value.length > 0, `${key} is empty`);
  }
});

/* ------------------------------------------------------------------------ */

if (failed > 0) {
  console.error(`\n${failed} of ${ran} header tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} header tests passed.`);
