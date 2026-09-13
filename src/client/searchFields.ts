/**
 * Which field a Discogs search runs against.
 *
 * Discogs treats these as genuinely different searches rather than as hints,
 * which is why this is a choice and not a guess:
 *
 *   - `q` is a fuzzy match over artist and release title. It does **not**
 *     look at tracklists, so searching a track name only works when that name
 *     also happens to be the release title. For a 12" with four untitled cuts
 *     it returns nothing at all.
 *   - `track` searches tracklists. This is the "I know the track, I want the
 *     EP it is on" case, and it was the biggest gap in the panel.
 *   - `catno` and `barcode` are exact-match fields. A catalogue number typed
 *     into `q` is noise that happens to appear in some release notes; typed
 *     into `catno` it identifies one pressing.
 *
 * Guessing the field from the shape of the input was the alternative. It is
 * wrong often enough to be annoying — plenty of real record titles look like
 * catalogue numbers — and a search that silently ran a different query than
 * you asked for is worse than one extra tap.
 */
export type SearchField = "all" | "track" | "catno" | "barcode";

export interface FieldSpec {
  key: SearchField;
  /** Short enough for a pill on a phone. */
  label: string;
  placeholder: string;
  /** Discogs rejects very short values on the exact-match fields. */
  minLength: number;
}

export const SEARCH_FIELDS: readonly FieldSpec[] = [
  {
    key: "all",
    label: "All",
    placeholder: "Artist or release title…",
    minLength: 2,
  },
  {
    key: "track",
    label: "Track",
    placeholder: "Track title, to find the record it's on…",
    minLength: 2,
  },
  {
    key: "catno",
    label: "Cat #",
    placeholder: "Catalogue number off the label, e.g. PF-045",
    minLength: 1,
  },
  {
    key: "barcode",
    label: "Barcode",
    placeholder: "Barcode from the sleeve…",
    minLength: 6,
  },
];

export function specFor(field: SearchField): FieldSpec {
  return SEARCH_FIELDS.find((spec) => spec.key === field) ?? SEARCH_FIELDS[0]!;
}

/**
 * The query string for a search, or null when there is not enough to send.
 *
 * Returning null rather than a short query matters: the route rejects these
 * with a 400, and spending one of sixty requests a minute to be told off is a
 * waste of a budget shared with collection sync.
 */
export function searchQueryFor(
  field: SearchField,
  value: string,
): string | null {
  const trimmed = value.trim();
  const spec = specFor(field);
  if (trimmed.length < spec.minLength) return null;

  // Sent as `q` for "all", and under its own name otherwise. URLSearchParams
  // does the encoding, so a value containing & or = cannot add a parameter.
  const params = new URLSearchParams();
  params.set(field === "all" ? "q" : field, trimmed);
  return params.toString();
}

/** What to say when there is not enough typed yet. */
export function tooShortMessage(field: SearchField): string {
  const spec = specFor(field);
  return spec.minLength === 1
    ? "Type a catalogue number."
    : `Type at least ${spec.minLength} characters.`;
}
