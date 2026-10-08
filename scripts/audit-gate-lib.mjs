/**
 * The dependency-audit gate, as a pure function so it can be tested.
 *
 * Plain `npm audit --audit-level=high` has one answer to an advisory with no
 * fix: CI stays red until upstream ships one, which teaches everyone to stop
 * reading the CI badge. This gate keeps the strict default and adds one
 * narrow, written-down exception:
 *
 *   - Anything high or critical that reaches the PRODUCTION dependency tree
 *     fails. No allowlist applies there, ever.
 *   - A high/critical advisory that exists only in dev tooling (the CSS
 *     build, the linter) may be accepted, but only by an entry in
 *     .github/audit-allowlist.json that names the advisory, says why, and
 *     carries an expiry date. An expired entry fails the build, so every
 *     acceptance is re-reviewed instead of becoming permanent.
 *   - An entry that no longer matches anything is reported, so the list
 *     shrinks as fixes land.
 */

const BLOCKING = new Set(["high", "critical"]);

/** An exception may run at most this far ahead, so none quietly becomes permanent. */
export const MAX_EXCEPTION_DAYS = 180;

const GHSA = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

/**
 * Whether a parsed `npm audit --json` result is a real report. When the
 * registry can't be reached npm still prints JSON — an `error` object and no
 * `vulnerabilities` — and reading that as "nothing found" would turn an
 * outage into a pass. The gate fails closed instead.
 */
export function isAuditReport(report) {
  return Boolean(
    report &&
      typeof report === "object" &&
      !report.error &&
      report.vulnerabilities &&
      typeof report.vulnerabilities === "object" &&
      report.metadata &&
      typeof report.metadata === "object",
  );
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** GHSA id from an advisory URL, or null. */
export function ghsaOf(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(String(url ?? ""));
  return match ? match[0].toUpperCase() : null;
}

/**
 * Every blocking advisory in an `npm audit --json` report, one per GHSA id,
 * with the packages it was found in. Transitive entries (`via` as a string)
 * are skipped: the advisory itself is listed under the package it lives in.
 */
export function blockingAdvisories(report) {
  const found = new Map();
  for (const [name, vuln] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || !BLOCKING.has(via.severity)) continue;
      const id = ghsaOf(via.url) ?? `npm-${via.source}`;
      const entry = found.get(id) ?? { id, title: via.title, severity: via.severity, packages: new Set() };
      entry.packages.add(via.name ?? name);
      found.set(id, entry);
    }
  }
  return [...found.values()].map((a) => ({ ...a, packages: [...a.packages].sort() }));
}

/**
 * @param full    `npm audit --json`
 * @param prod    `npm audit --omit=dev --json`
 * @param allow   parsed .github/audit-allowlist.json (array)
 * @param today   "YYYY-MM-DD"
 */
export function evaluate({ full, prod, allow, today }) {
  const failures = [];
  const accepted = [];
  const notes = [];

  if (!isAuditReport(full) || !isAuditReport(prod)) {
    failures.push("npm audit did not return a report (registry unreachable?); refusing to pass without one");
    return { ok: false, failures, accepted, notes };
  }

  const entries = Array.isArray(allow) ? allow : [];
  const byId = new Map(entries.map((e) => [String(e.advisory).toUpperCase(), e]));

  for (const entry of entries) {
    if (!GHSA.test(String(entry.advisory ?? ""))) {
      failures.push(`allowlist entry ${entry.advisory} is not a GHSA id`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expires ?? "")) || Number.isNaN(Date.parse(entry.expires))) {
      failures.push(`allowlist entry ${entry.advisory} has no valid "expires" date`);
    } else if (entry.expires < today) {
      failures.push(`allowlist entry ${entry.advisory} expired on ${entry.expires}: review it again`);
    } else if (daysBetween(today, entry.expires) > MAX_EXCEPTION_DAYS) {
      failures.push(
        `allowlist entry ${entry.advisory} runs to ${entry.expires}, more than ${MAX_EXCEPTION_DAYS} days out; pick a nearer review date`,
      );
    }
    if (!entry.reason || String(entry.reason).trim().length < 20) {
      failures.push(`allowlist entry ${entry.advisory} needs a real reason`);
    }
  }

  const inProd = new Set(blockingAdvisories(prod).map((a) => a.id));

  for (const advisory of blockingAdvisories(full)) {
    const label = `${advisory.severity} ${advisory.id} in ${advisory.packages.join(", ")} (${advisory.title})`;
    if (inProd.has(advisory.id)) {
      failures.push(`${label} reaches production dependencies; no exception applies`);
      continue;
    }
    const entry = byId.get(advisory.id);
    if (!entry) {
      failures.push(`${label} is not in .github/audit-allowlist.json`);
      continue;
    }
    if (entry.expires >= today) accepted.push(`${label}, dev-only, accepted until ${entry.expires}`);
  }

  const seen = new Set(blockingAdvisories(full).map((a) => a.id));
  for (const id of byId.keys()) {
    if (!seen.has(id)) notes.push(`allowlist entry ${id} no longer matches anything; remove it`);
  }

  return { ok: failures.length === 0, failures, accepted, notes };
}
