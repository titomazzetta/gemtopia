/**
 * Dependency-audit gate tests.   npm run test:audit-gate
 *
 * The gate may accept a known, dev-only advisory that has no fix, but only
 * on a written, dated exception, and never anything that ships to users.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate, blockingAdvisories, ghsaOf, isAuditReport } from "./audit-gate-lib.mjs";

let ran = 0;
let failed = 0;
function check(name, fn) {
  ran += 1;
  try { fn(); } catch (error) { failed += 1; console.error(`FAIL  ${name}\n      ${error.message}`); }
}

const adv = (name, id, severity = "high") => ({
  [name]: { severity, via: [{ source: 1, name, title: `${name} bug`, url: `https://github.com/advisories/${id}`, severity }] },
});
const report = (...parts) => ({ auditReportVersion: 2, metadata: { vulnerabilities: {} }, vulnerabilities: Object.assign({}, ...parts) });
const transitive = { chokidar: { severity: "high", via: ["braces"] } };
const ID = "GHSA-vfj7-8cjw-p6xm";
const entry = (over = {}) => ({ advisory: ID, reason: "dev-only, no upstream fix, reviewed", expires: "2027-01-05", ...over });
const TODAY = "2026-10-07";

check("ghsaOf reads the id from an advisory URL", () => {
  assert.equal(ghsaOf(`https://github.com/advisories/${ID}`), ID.toUpperCase());
  assert.equal(ghsaOf("https://example.com"), null);
});

check("transitive entries are not double counted", () => {
  const found = blockingAdvisories(report(adv("braces", ID), transitive));
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].packages, ["braces"]);
});

check("a clean audit passes", () => {
  assert.equal(evaluate({ full: report(), prod: report(), allow: [], today: TODAY }).ok, true);
});

check("an unlisted high advisory fails", () => {
  const r = evaluate({ full: report(adv("braces", ID)), prod: report(), allow: [], today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /not in .github\/audit-allowlist.json/);
});

check("a listed, unexpired, dev-only advisory is accepted and said so", () => {
  const r = evaluate({ full: report(adv("braces", ID), transitive), prod: report(), allow: [entry()], today: TODAY });
  assert.equal(r.ok, true);
  assert.match(r.accepted[0], /accepted until 2027-01-05/);
});

check("the allowlist never covers production dependencies", () => {
  const r = evaluate({ full: report(adv("braces", ID)), prod: report(adv("braces", ID)), allow: [entry()], today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /reaches production/);
});

check("an expired entry fails, even if the advisory is gone", () => {
  const r = evaluate({ full: report(), prod: report(), allow: [entry({ expires: "2026-10-01" })], today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /expired on 2026-10-01/);
});

check("an entry without a date or a reason fails", () => {
  const noDate = evaluate({ full: report(), prod: report(), allow: [entry({ expires: undefined })], today: TODAY });
  const noReason = evaluate({ full: report(), prod: report(), allow: [entry({ reason: "ok" })], today: TODAY });
  assert.equal(noDate.ok, false);
  assert.equal(noReason.ok, false);
});

check("moderate advisories don't block", () => {
  const r = evaluate({ full: report(adv("postcss-selector-parser", "GHSA-rj75-hqrm-r3gf", "moderate")), prod: report(), allow: [], today: TODAY });
  assert.equal(r.ok, true);
});

check("critical blocks like high", () => {
  const r = evaluate({ full: report(adv("x", "GHSA-aaaa-bbbb-cccc", "critical")), prod: report(), allow: [], today: TODAY });
  assert.equal(r.ok, false);
});

check("a stale entry is reported so the list shrinks", () => {
  const r = evaluate({ full: report(), prod: report(), allow: [entry()], today: TODAY });
  assert.equal(r.ok, true);
  assert.match(r.notes[0], /no longer matches/);
});

check("an npm error instead of a report fails closed", () => {
  const offline = { error: { code: "ENOTFOUND", summary: "registry unreachable" } };
  assert.equal(isAuditReport(offline), false);
  assert.equal(isAuditReport(report()), true);
  const r = evaluate({ full: offline, prod: offline, allow: [], today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.failures[0], /did not return a report/);
  // Even with a prod report missing alone.
  assert.equal(evaluate({ full: report(), prod: {}, allow: [], today: TODAY }).ok, false);
});

check("an exception can't be parked far in the future", () => {
  const r = evaluate({ full: report(adv("braces", ID)), prod: report(), allow: [entry({ expires: "2099-01-01" })], today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /more than 180 days out/);
});

check("an exception must name a real GHSA id", () => {
  const r = evaluate({ full: report(), prod: report(), allow: [entry({ advisory: "braces" })], today: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /not a GHSA id/);
});

check("the allowlist checked into the repo is itself valid today", () => {
  const allow = JSON.parse(readFileSync(new URL("../.github/audit-allowlist.json", import.meta.url), "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const r = evaluate({ full: report(), prod: report(), allow, today });
  assert.deepEqual(r.failures, []);
});

if (failed > 0) { console.error(`\n${failed} of ${ran} audit-gate tests failed.`); process.exit(1); }
console.log(`All ${ran} audit-gate tests passed.`);
