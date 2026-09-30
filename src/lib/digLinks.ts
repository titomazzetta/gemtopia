/**
 * The two relationships a DJ follows first, as data: who else made this
 * record, and what other versions of it exist.
 *
 * Kept free of network code so the choices can be tested. `dig.ts` does the
 * fetching; this decides which credit to follow and how a version reads.
 *
 * Credits are the connection record shops file by and liner notes reward:
 * the remixer on the B-side, the producer behind three different aliases.
 * Discogs records them as `extraartists` on the release and on each track.
 * Most of those credits are not worth following — mastering, lacquer cut,
 * artwork, photography — so only the roles that shape the music count, in
 * order of how often they lead somewhere a DJ wants to go.
 */

export interface Credit {
  id: number;
  name: string;
  role: string;
}

/** Roles worth digging through, most useful first. Anything else is ignored. */
const ROLE_RANK: Array<[RegExp, number]> = [
  [/\bremix/i, 0],
  [/\bco-?produc|\bproduc/i, 1],
  [/\bwritten|\bcompos|\bsongwriter/i, 2],
  [/\bedit(ed)? by|\bre-?edit/i, 3],
];

export function creditRank(role: string): number | null {
  for (const [pattern, rank] of ROLE_RANK) if (pattern.test(role)) return rank;
  return null;
}

/** Discogs' own disambiguation suffix, "Moodymann (2)" → "Moodymann". */
function cleanName(name: string): string {
  return name.replace(/\s+\(\d+\)$/, "").trim();
}

/**
 * Which credited people to dig through, best first.
 *
 * Skips the record's own main artists (that lane already exists), anyone
 * without a Discogs id, "Various" and "Unknown Artist" placeholders, and
 * roles that do not shape the music. One entry per person, carrying their
 * most useful role.
 */
export function pickCredits(
  credits: readonly Credit[],
  mainArtistIds: readonly number[],
  max = 2,
): Credit[] {
  const main = new Set(mainArtistIds);
  const best = new Map<number, { credit: Credit; rank: number; order: number }>();

  credits.forEach((credit, order) => {
    if (!Number.isInteger(credit.id) || credit.id <= 0) return;
    if (main.has(credit.id)) return;
    const name = cleanName(credit.name);
    if (!name || /^(various|unknown artist)$/i.test(name)) return;
    const rank = creditRank(credit.role);
    if (rank === null) return;

    const existing = best.get(credit.id);
    if (!existing || rank < existing.rank) {
      best.set(credit.id, { credit: { id: credit.id, name, role: credit.role.trim() }, rank, order });
    }
  });

  return [...best.values()]
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, Math.max(0, max))
    .map((entry) => entry.credit);
}

/** "Remix", "Producer", "Written-By" → a short word for a card. */
export function roleWord(role: string): string {
  const rank = creditRank(role);
  if (rank === 0) return "remixer";
  if (rank === 1) return "producer";
  if (rank === 2) return "writer";
  if (rank === 3) return "editor";
  return "credit";
}

export interface MasterVersion {
  id: number;
  title: string;
  label: string | null;
  country: string | null;
  format: string | null;
  released: string | null;
  thumb: string;
}

/**
 * How another version of the record reads on its card: what makes it
 * different. The format carries it for DJs — "12\", Promo" versus "LP" —
 * then where and when.
 */
export function versionReason(version: MasterVersion): string {
  const year = version.released?.match(/\d{4}/)?.[0] ?? null;
  const parts = [version.format, version.country, year].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return parts.length > 0 ? `Another version — ${parts.join(", ")}` : "Another version of this record";
}

/* ------------------------------------------------------------------ */
/* The labels an artist has released on                               */
/* ------------------------------------------------------------------ */

/** Not a label anyone digs through — Discogs' marker for self-released. */
const NOT_A_LABEL = /^(not on label|no label|self[- ]?released|unknown|white label)\b/i;

/**
 * The other labels an artist has put records out on, most-used first.
 *
 * These are where their world is: the label that signed them twice, the one
 * that picked up their remix, the crew they came up with. Digging a label
 * the artist trusts, through records by *other* artists, is how a DJ finds
 * the next name — so the labels come from the artist's discography, and the
 * records come from the label.
 *
 * The seed's own labels are left out (there is already a lane for those), as
 * are "Not On Label" and friends. Names are compared case-insensitively
 * because Discogs spells the same label differently across releases.
 */
export function artistLabels(
  rows: ReadonlyArray<{ label: string | null }>,
  seedLabels: ReadonlyArray<string>,
): string[] {
  const skip = new Set(seedLabels.map((name) => name.trim().toLowerCase()));
  const counts = new Map<string, { name: string; count: number; first: number }>();
  rows.forEach((row, index) => {
    const name = row.label?.trim();
    if (!name || NOT_A_LABEL.test(name)) return;
    const key = name.toLowerCase();
    if (skip.has(key)) return;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { name, count: 1, first: index });
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .map((entry) => entry.name);
}

/**
 * Which of those labels this dig follows, and which page of it.
 *
 * One label per dig keeps a dig inside its upstream budget. "Dig deeper"
 * moves to the next label rather than further down the same one, so a few
 * presses walk the artist's whole label history; once every label has had a
 * turn, it comes round again one page further in.
 */
export function labelForPage(
  labels: ReadonlyArray<string>,
  page: number,
): { label: string; page: number } | null {
  if (labels.length === 0) return null;
  const turn = Math.max(0, Math.floor(page) - 1);
  const label = labels[turn % labels.length];
  return label ? { label, page: Math.floor(turn / labels.length) + 1 } : null;
}
