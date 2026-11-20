import { DISCOGS_AFFILIATION_NOTICE, DISCOGS_DATA_NOTICE } from "@/lib/discogsNotices";
import { DISCOGS_HOME } from "@/lib/discogs-links";

/**
 * Discogs' data credit, as a link to the Discogs page the data is on.
 *
 * Pass the page that holds what is on screen — a release, your collection —
 * and it falls back to discogs.com where a view mixes many records.
 *
 * `noreferrer` keeps the address of the page you were on to yourself (on a
 * share link that address is a credential). It is not `nofollow`: Discogs'
 * terms ask that the link back pass ranking credit, and this one does.
 *
 * No "use client": it renders the same on the server-rendered share page and
 * inside the app.
 */
export function DiscogsCredit({ href = DISCOGS_HOME, className = "" }: { href?: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`underline decoration-dotted underline-offset-2 hover:text-accent ${className}`}
    >
      {DISCOGS_DATA_NOTICE}
    </a>
  );
}

/** The "not affiliated" notice, in Discogs' own words. */
export function DiscogsDisclaimer({ className = "" }: { className?: string }) {
  return <p className={className}>{DISCOGS_AFFILIATION_NOTICE}</p>;
}
