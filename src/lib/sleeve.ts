/**
 * Scan a sleeve: the pure half.
 *
 * A photo of a record — its barcode, its label, its spine — becomes a few
 * fields (`SleeveRead`), the fields become Discogs searches, and the hits
 * become ranked candidates with a reason each ("barcode", "catalogue number",
 * "reads like"). Nothing here touches the network or a camera, so all of it
 * is tested in scripts/test-sleeve.mjs. The browser side is
 * client/sleeveImage.ts (the photo) and components/ScanSheet.tsx (the
 * cards); the model that reads a photo is lib/llm.ts `readSleeve`.
 *
 * What the model's answer is, precisely: untrusted text. It is parsed with a
 * strict schema, every string is cleaned like a chat message and cut to a
 * length, a barcode keeps only digits, and nothing in it is ever executed,
 * rendered as markup, or used as a key into anything but a Discogs search
 * the user could have typed.
 */

import { z } from "zod";
import { cleanLabel } from "./chat";

/** What can be read off a sleeve, label or spine. Every field is optional. */
export interface SleeveRead {
  /** EAN-13 / UPC-A digits, no spaces. */
  barcode: string | null;
  /** Catalogue number as printed: "KDJ 44", "PF-045". */
  catno: string | null;
  label: string | null;
  artist: string | null;
  title: string | null;
  year: number | null;
  /** The reader's own confidence, 0–1, when it gave one. */
  confidence: number | null;
  /** How the fields were found. */
  source: "barcode-scanner" | "model" | "typed";
}

/** The model's answer, as JSON. Loose on the way in, strict on the way out. */
const modelReadSchema = z
  .object({
    barcode: z.union([z.string(), z.number(), z.null()]).optional(),
    catno: z.union([z.string(), z.null()]).optional(),
    label: z.union([z.string(), z.null()]).optional(),
    artist: z.union([z.string(), z.null()]).optional(),
    title: z.union([z.string(), z.null()]).optional(),
    year: z.union([z.number(), z.string(), z.null()]).optional(),
    confidence: z.union([z.number(), z.null()]).optional(),
  })
  .passthrough();

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = cleanLabel(value, max);
  return cleaned === "" ? null : cleaned;
};

/**
 * Barcode digits only. UPC-A (12 digits) is the same code as EAN-13 with a
 * leading zero, and Discogs stores either as printed, so both forms are kept
 * in mind by `barcodeForms`. Anything that isn't 8, 12 or 13 digits after
 * cleaning is treated as unread rather than searched.
 */
export function normaliseBarcode(value: unknown): string | null {
  if (typeof value === "number") value = String(value);
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D+/g, "");
  return digits.length === 8 || digits.length === 12 || digits.length === 13 ? digits : null;
}

/** The ways one barcode can be written: as read, and with/without the EAN leading zero. */
export function barcodeForms(barcode: string): string[] {
  const forms = new Set([barcode]);
  if (barcode.length === 12) forms.add(`0${barcode}`);
  if (barcode.length === 13 && barcode.startsWith("0")) forms.add(barcode.slice(1));
  return [...forms];
}

/** A catalogue number, as a Discogs search wants it: one space, no stray punctuation at the ends. */
export function normaliseCatno(value: unknown): string | null {
  const cleaned = text(value, 60);
  if (!cleaned) return null;
  const tidy = cleaned.replace(/^[\s:#]+|[\s:#.]+$/g, "").replace(/\s+/g, " ");
  return tidy.length >= 2 ? tidy : null;
}

/**
 * The model's JSON, made into a read. Returns null when nothing usable was
 * read (no barcode, no catalogue number, no artist or title).
 */
export function readFromModel(raw: unknown): SleeveRead | null {
  const parsed = modelReadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const year =
    typeof d.year === "number"
      ? d.year
      : typeof d.year === "string" && /^\d{4}$/.test(d.year.trim())
        ? Number(d.year.trim())
        : null;
  const read: SleeveRead = {
    barcode: normaliseBarcode(d.barcode),
    catno: normaliseCatno(d.catno),
    label: text(d.label, 120),
    artist: text(d.artist, 200),
    title: text(d.title, 200),
    year: year !== null && year >= 1900 && year <= 2100 ? year : null,
    confidence:
      typeof d.confidence === "number" && Number.isFinite(d.confidence)
        ? Math.min(1, Math.max(0, d.confidence))
        : null,
    source: "model",
  };
  return read.barcode || read.catno || read.artist || read.title ? read : null;
}

/** A read from a barcode the phone decoded itself. */
export function readFromBarcode(code: string): SleeveRead | null {
  const barcode = normaliseBarcode(code);
  if (!barcode) return null;
  return { barcode, catno: null, label: null, artist: null, title: null, year: null, confidence: 1, source: "barcode-scanner" };
}

/** One Discogs search to try, in order of how exact it is. */
export interface SleeveSearch {
  by: "barcode" | "catno" | "text";
  params: { barcode?: string; catno?: string; q?: string };
  /** What to say about it: "Barcode 5 020…". */
  says: string;
}

/**
 * The searches a read earns, most exact first: the barcode (one pressing),
 * then the catalogue number (one pressing, usually), then the words. The
 * caller tries them in order and stops at the first that finds anything
 * worth showing.
 */
export function searchesFor(read: SleeveRead): SleeveSearch[] {
  const out: SleeveSearch[] = [];
  if (read.barcode) {
    out.push({ by: "barcode", params: { barcode: read.barcode }, says: `Barcode ${read.barcode}` });
  }
  if (read.catno) {
    out.push({ by: "catno", params: { catno: read.catno }, says: `Cat # ${read.catno}` });
  }
  const words = [read.artist, read.title].filter((w): w is string => Boolean(w)).join(" ").trim();
  if (words.length >= 2) {
    out.push({ by: "text", params: { q: words.slice(0, 120) }, says: `Reads “${words.slice(0, 80)}”` });
  } else if (read.label && read.catno === null) {
    out.push({ by: "text", params: { q: read.label.slice(0, 120) }, says: `Reads “${read.label.slice(0, 80)}”` });
  }
  return out;
}

/** The hit fields the ranking looks at — a subset of discogs.SearchHit. */
export interface SleeveHit {
  id: number;
  artist: string;
  title: string;
  year: number | null;
  labels: string[];
  catno: string | null;
  barcodes: string[];
  formats: string[];
}

export type Ownership = "collection" | "wantlist" | "none";

export interface SleeveCandidate<H extends SleeveHit = SleeveHit> {
  hit: H;
  ownership: Ownership;
  /** Why this one: "Barcode matches", "Cat # KDJ 44", "Title and artist match". */
  reason: string;
  /** 0–100: how sure the match is, for ordering and for "Is it this one?" wording. */
  score: number;
}

const fold = (value: string | null | undefined): string =>
  (value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const foldCatno = (value: string | null | undefined): string => fold(value).replace(/\s+/g, "");

/** How much of `wanted`'s words appear in `got`, 0–1. */
function wordOverlap(wanted: string, got: string): number {
  const w = fold(wanted).split(" ").filter((x) => x.length > 1);
  if (w.length === 0) return 0;
  const g = new Set(fold(got).split(" "));
  return w.filter((x) => g.has(x)).length / w.length;
}

/**
 * Rank what a search returned against what was read, your collection first.
 *
 * The score is what the search proved plus how well the words agree: a
 * barcode hit is near-certain on its own; a catalogue-number hit is strong
 * (a few labels reuse numbers); a text hit is only as good as the overlap of
 * artist and title. Owning the pressing, or wanting it, then breaks ties —
 * when you photographed a record you own, that is the one you meant. Vinyl
 * edges out a CD or a file of the same record for a vinyl DJ's set.
 */
export function rankCandidates<H extends SleeveHit>(
  read: SleeveRead,
  hits: readonly H[],
  by: SleeveSearch["by"],
  sets: { collection: ReadonlySet<number>; wantlist: ReadonlySet<number> },
): SleeveCandidate<H>[] {
  const forms = read.barcode ? new Set(barcodeForms(read.barcode)) : null;
  const scored = hits.map((hit): SleeveCandidate<H> => {
    const ownership: Ownership = sets.collection.has(hit.id)
      ? "collection"
      : sets.wantlist.has(hit.id)
        ? "wantlist"
        : "none";
    let score = 0;
    let reason = "";
    const barcodeHit = Boolean(forms && hit.barcodes.some((b) => forms.has(b.replace(/\D+/g, ""))));
    const catnoHit = Boolean(read.catno && hit.catno && foldCatno(hit.catno) === foldCatno(read.catno));
    const artistOverlap = read.artist ? wordOverlap(read.artist, hit.artist) : 0;
    const titleOverlap = read.title ? wordOverlap(read.title, hit.title) : 0;
    const labelHit = Boolean(read.label && hit.labels.some((l) => fold(l) === fold(read.label)));

    if (barcodeHit) {
      score = 90;
      reason = "Barcode matches";
    } else if (by === "barcode") {
      // Discogs matched the barcode but didn't echo it: still the search's word.
      score = 80;
      reason = `Barcode ${read.barcode}`;
    } else if (catnoHit) {
      score = 70;
      reason = `Cat # ${hit.catno}`;
    } else if (by === "catno") {
      score = 55;
      reason = `Cat # ${read.catno}`;
    } else {
      score = Math.round(40 * ((artistOverlap + titleOverlap) / (read.artist && read.title ? 2 : 1)));
      reason =
        artistOverlap >= 0.99 && titleOverlap >= 0.99
          ? "Title and artist match"
          : titleOverlap > 0 || artistOverlap > 0
            ? "Reads like this record"
            : "Nearest Discogs match";
    }
    // Agreement beyond what the search proved.
    if (by !== "text") score += Math.round(10 * ((artistOverlap + titleOverlap) / 2));
    if (labelHit) score += 5;
    if (read.year !== null && hit.year === read.year) score += 3;
    if (hit.formats.some((f) => /vinyl/i.test(f))) score += 2;
    if (ownership === "collection") score += 15;
    else if (ownership === "wantlist") score += 5;
    return { hit, ownership, reason, score: Math.min(100, score) };
  });
  return scored.sort((a, b) => b.score - a.score || a.hit.id - b.hit.id);
}

/** Sure enough to show as "this one" rather than "could be one of these". */
export const SURE_SCORE = 60;

/**
 * The line under a card: what you own, what it is.
 *   "Your copy" · "On your wantlist" · "Not in your collection"
 */
export function ownershipLabel(ownership: Ownership): string {
  switch (ownership) {
    case "collection":
      return "Your copy";
    case "wantlist":
      return "On your wantlist";
    default:
      return "Not in your collection";
  }
}
