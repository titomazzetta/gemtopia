/**
 * A fake Discogs, installed at the browser as Playwright route handlers on the
 * app's own /api/discogs/* routes (and the few others that reach Discogs:
 * /api/dig, /api/wantlist, /api/collection, /api/scan).
 *
 * Why at the browser and not a fake upstream: the routes' own code — session,
 * CSRF, validation, rate limits — is covered by scripts/test-api.mjs against a
 * stub Anthropic and a real Postgres. What the browser flows need is a crate
 * that syncs for real in the test browser, with records built to exercise the
 * UI: a VA compilation with a different artist on every track, tracks whose
 * length only the clip knows, a record with no clips at all, a record filed in
 * a "Listening" folder, a double with a copy in two folders, a want. Answering
 * at the browser keeps the flows
 * independent of Discogs' rate limits and of a token nobody can check in.
 *
 * Everything here is invented. Ids above 990000 are "strangers" — records
 * nobody owns — and the rest are the owner's shelf.
 */

const thumb = (hue) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="hsl(${hue} 40% 30%)"/><circle cx="32" cy="32" r="22" fill="hsl(${hue} 30% 12%)"/><circle cx="32" cy="32" r="5" fill="hsl(${hue} 40% 45%)"/></svg>`,
  )}`;

const t = (position, title, duration = null, artists = []) => ({ position, title, duration, artists });
const v = (id, title, duration) => ({ id, title, duration });

let seq = 0;
function release(id, spec) {
  seq += 1;
  const summary = {
    id,
    title: spec.title,
    artist: spec.artist,
    year: spec.year ?? null,
    genres: spec.genres ?? ["Electronic"],
    styles: spec.styles ?? [],
    labels: spec.labels ?? [],
    formats: spec.formats ?? ["Vinyl", '12"'],
    country: spec.country ?? "US",
    artistIds: spec.artistIds ?? [100000 + id],
    labelIds: spec.labelIds ?? [200000 + id],
    addedAt: new Date(Date.UTC(2026, 0, 1 + seq)).toISOString(),
    thumb: thumb(spec.hue ?? (id * 37) % 360),
    coverImage: thumb(spec.hue ?? (id * 37) % 360),
    /** Discogs collection folders this record is filed in (collection only). */
    folderIds: spec.folderIds ?? [1],
  };
  const detail = {
    ...summary,
    tracks: spec.tracks ?? [],
    videos: spec.videos ?? [],
    notes: spec.notes ?? null,
    market: { forSale: 3, lowestPrice: 12.5, have: 420, want: 1200 },
    fetchedAt: Date.now(),
  };
  const hit = {
    id,
    artist: spec.artist,
    title: spec.title,
    year: spec.year ?? null,
    thumb: summary.thumb,
    labels: summary.labels,
    genres: summary.genres,
    styles: summary.styles,
    country: summary.country,
    formats: summary.formats,
    catno: spec.catno ?? null,
    barcodes: spec.barcode ? [spec.barcode] : [],
    have: 420,
    want: 1200,
  };
  return { summary, detail, hit, spec };
}

export const FOLDERS = [
  { id: 0, name: "All", count: 7 },
  { id: 1, name: "Uncategorized", count: 5 },
  { id: 2, name: "Listening", count: 1 },
  { id: 3, name: "DJ", count: 1 },
];

/**
 * One row per copy, the way /api/discogs/collection answers: a record filed
 * in two folders is two rows, each with its own copy's folder. The doubles go
 * first, so with a small page size (options.pageSize) a record's two copies
 * land on different pages of the listing.
 */
function copies(summaries) {
  const first = summaries.map((s) => ({ ...s, folderIds: s.folderIds.slice(0, 1) }));
  const doubles = summaries.flatMap((s) => s.folderIds.slice(1).map((folder) => ({ ...s, folderIds: [folder] })));
  return [...doubles, ...first];
}

export const COLLECTION = [
  release(101, {
    title: "Shiva EP", artist: "Kerri Chandler", year: 1998, labels: ["King Street Sounds"], styles: ["Deep House"], hue: 140, catno: "KSS-1098",
    tracks: [t("A1", "Shiva", "7:05"), t("A2", "Shiva (Dub)", "6:50"), t("B1", "Bar A Thym", "6:12")],
    videos: [v("aaaaaaaaaaa", "Kerri Chandler - Shiva", 425), v("bbbbbbbbbbb", "Kerri Chandler - Shiva (Dub)", 410)],
  }),
  // A compilation: a different artist on every track, which only the
  // tracklist knows. A2 has no printed length — the clip's runtime stands in.
  release(102, {
    title: "Deep Cuts Volume One", artist: "Various", year: 2001, labels: ["Grape City Records"], styles: ["Deep House", "Techno"], hue: 200, catno: "GCR-012",
    tracks: [
      t("A1", "Mirror", "5:34", ["Nate Krafft"]),
      t("A2", "Dolphin Dreams", null, ["Larry Heard"]),
      t("B1", "Shiva (Compilation Edit)", "6:00", ["Kerri Chandler"]),
    ],
    videos: [
      v("ccccccccccc", "Nate Krafft - Mirror", 334),
      v("ddddddddddd", "Larry Heard - Dolphin Dreams", 332),
      v("eeeeeeeeeee", "Kerri Chandler - Shiva (Compilation Edit)", 360),
    ],
  }),
  // No clips at all: every track record only.
  release(103, {
    title: "Atmospheric Beats EP", artist: "Kerri Chandler", year: 1993, labels: ["Shelter Records"], styles: ["Deep House"], hue: 160, catno: "SHL-1007",
    tracks: [t("A1", "Atmospheric Beats", "6:31"), t("A2", "Get It Off", "5:58"), t("B1", "Inspiration", "6:04")],
    videos: [],
  }),
  // Filed under "Listening": an album, not a DJ record.
  release(104, {
    title: "Illusions", artist: "Alpine DJ", year: 2024, labels: ["Grape City Records"], styles: ["Ambient"], formats: ["Vinyl", "LP", "Album"], hue: 100, folderIds: [2], catno: "GCR-LP-2",
    tracks: [t("A1", "Illusions", "6:40"), t("A2", "Lucid", "6:02"), t("B1", "Daybreak", "7:01")],
    videos: [v("fffffffffff", "Alpine DJ - Illusions", 400), v("ggggggggggg", "Alpine DJ - Lucid", 362)],
  }),
  release(105, {
    title: "Can You Feel It", artist: "Mr. Fingers", year: 1986, labels: ["Trax Records"], styles: ["Deep House"], hue: 50, catno: "TX127", barcode: "5020105123456",
    tracks: [t("A", "Can You Feel It", "6:38"), t("B", "Mystery Of Love", "6:52")],
    videos: [v("hhhhhhhhhhh", "Mr. Fingers - Can You Feel It", 398)],
  }),
  // Two copies: one in Uncategorized, a double in "DJ".
  release(106, {
    title: "Crimson Arsenal E.P.", artist: "Nate Krafft", year: 1995, labels: ["Infra"], styles: ["Techno"], hue: 0, folderIds: [1, 3], catno: "INFRA-003",
    tracks: [t("A1", "Mirror / ʀoʀʀiM", "5:34"), t("A2", "I.Q.", "5:10"), t("B1", "Antimatter", "6:20")],
    videos: [v("iiiiiiiiiii", "Nate Krafft - Mirror", 334), v("jjjjjjjjjjj", "Nate Krafft - Antimatter", 380)],
  }),
];

export const WANTLIST = [
  release(301, {
    title: "Sceneries Not Songs, Volume One", artist: "Larry Heard", year: 1994, labels: ["Black Market International"], styles: ["Deep House"], hue: 230, catno: "BMI-001",
    tracks: [t("A1", "Bassline", "6:10"), t("A2", "Dolphin Dreams", "5:32"), t("B1", "Riverside Drive", "6:47")],
    videos: [v("kkkkkkkkkkk", "Larry Heard - Riverside Drive", 407), v("lllllllllll", "Larry Heard - Bassline", 370)],
  }),
];

export const STRANGERS = [
  release(990001, {
    title: "Mirror Dance", artist: "Unknown Artist", year: 1996, labels: ["White"], styles: ["Techno"], hue: 300, catno: "CAT-100", barcode: "0123456789012",
    tracks: [t("A", "Mirror Dance", null), t("B", "Mirror Dance (Dub)", null)],
    videos: [v("mmmmmmmmmmm", "Unknown Artist - Mirror Dance", 390)],
  }),
  release(990002, {
    title: "Heard It All", artist: "Larry Heard", year: 1999, labels: ["Track Mode"], styles: ["Deep House"], hue: 260, catno: "TM-004",
    tracks: [t("A1", "Heard It All", "7:20"), t("B1", "Dub Mode", "6:40")],
    videos: [v("nnnnnnnnnnn", "Larry Heard - Heard It All", 440)],
  }),
  release(990003, {
    title: "Night Moves", artist: "Nate Krafft", year: 2003, labels: ["Infra"], styles: ["Techno"], hue: 20, catno: "INFRA-011",
    tracks: [t("A1", "Night Moves", "6:00")],
    videos: [v("ooooooooooo", "Nate Krafft - Night Moves", 360)],
  }),
];

const ALL = [...COLLECTION, ...WANTLIST, ...STRANGERS];
const byId = new Map(ALL.map((r) => [r.summary.id, r]));

/** The order Discogs would return search hits in: strangers mixed with the shelf. */
const SEARCH_ORDER = [990001, 301, 990002, 101, 990003, 102, 104, 105, 106, 103];

function matches(r, params) {
  const has = (s, q) => s.toLowerCase().includes(q.toLowerCase());
  if (params.barcode) return r.hit.barcodes.includes(params.barcode.replace(/\D/g, ""));
  if (params.catno) return (r.hit.catno ?? "").toLowerCase() === params.catno.toLowerCase();
  if (params.artist) return has(r.summary.artist, params.artist) || r.spec.tracks.some((tr) => tr.artists.some((a) => has(a, params.artist)));
  if (params.track) return r.spec.tracks.some((tr) => has(tr.title, params.track));
  if (params.q) return has(r.summary.artist, params.q) || has(r.summary.title, params.q);
  return false;
}

/**
 * Install the fake on a Playwright context. Returns the mutable state so a
 * flow can assert what the browser asked for (wantlist adds, scans).
 */
export async function installFakeDiscogs(context, options = {}) {
  const state = {
    collection: new Set(COLLECTION.map((r) => r.summary.id)),
    wantlist: new Set(WANTLIST.map((r) => r.summary.id)),
    calls: [],
    scanAnswers: options.scanAnswers ?? [],
    /** Answer the collection listing the way a build before folders did. */
    omitFolderIds: options.omitFolderIds ?? false,
  };
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await context.route(/\/api\/discogs\/collection\?/, async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get("source") ?? "collection";
    const page = Number(url.searchParams.get("page") ?? "1");
    const perPage = options.pageSize ?? Number(url.searchParams.get("perPage") ?? "100");
    const ids = source === "wantlist" ? state.wantlist : state.collection;
    const summaries = [...ids].map((id) => byId.get(id)?.summary).filter(Boolean);
    // A want has no folder; a collection row is a copy.
    const items = source === "wantlist" || state.omitFolderIds ? summaries.map(({ folderIds: _none, ...row }) => row) : copies(summaries);
    const slice = items.slice((page - 1) * perPage, page * perPage);
    state.calls.push({ kind: "list", source, page });
    await json(route, { items: slice, page, pages: Math.max(1, Math.ceil(items.length / perPage)), total: items.length });
  });

  await context.route(/\/api\/discogs\/folders/, async (route) => {
    state.calls.push({ kind: "folders" });
    await json(route, { folders: FOLDERS });
  });

  await context.route(/\/api\/discogs\/releases\?/, async (route) => {
    const url = new URL(route.request().url());
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).map(Number);
    state.calls.push({ kind: "details", ids });
    await json(route, {
      results: ids.map((id) => (byId.has(id) ? { id, ok: true, release: byId.get(id).detail } : { id, ok: false, status: 404 })),
    });
  });

  await context.route(/\/api\/discogs\/search\?/, async (route) => {
    const url = new URL(route.request().url());
    const params = Object.fromEntries(url.searchParams.entries());
    state.calls.push({ kind: "search", params });
    const results = SEARCH_ORDER.map((id) => byId.get(id)).filter((r) => r && matches(r, params)).map((r) => r.hit);
    await json(route, { results });
  });

  await context.route(/\/api\/dig$/, async (route) => {
    const payload = route.request().postDataJSON();
    state.calls.push({ kind: "dig", seed: payload?.seed?.releaseId });
    const seed = payload?.seed?.releaseId ?? 0;
    const results = STRANGERS.filter((r) => r.summary.id !== seed).map((r) => ({
      releaseId: r.summary.id,
      title: r.summary.title,
      artist: r.summary.artist,
      year: r.summary.year,
      thumb: r.summary.thumb,
      labels: r.summary.labels,
      styles: r.summary.styles,
      genres: r.summary.genres,
      country: r.summary.country,
      lane: "same-style",
      reason: "Same style as the seed",
      have: 420,
      want: 1200,
      discogsUrl: `https://www.discogs.com/release/${r.summary.id}`,
      marketplaceUrl: `https://www.discogs.com/sell/release/${r.summary.id}`,
    }));
    await json(route, { seedReleaseId: seed, lanes: [{ lane: "same-style", label: "Same style", results }], fetchedAt: Date.now() });
  });

  await context.route(/\/api\/wantlist(\?|$)/, async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const { releaseId } = req.postDataJSON();
      state.wantlist.add(releaseId);
      state.calls.push({ kind: "want", releaseId });
      await json(route, { ok: true, releaseId, wanted: true });
      return;
    }
    if (req.method() === "DELETE") {
      const releaseId = Number(new URL(req.url()).searchParams.get("releaseId"));
      state.wantlist.delete(releaseId);
      state.calls.push({ kind: "unwant", releaseId });
      await json(route, { ok: true, releaseId, wanted: false });
      return;
    }
    await route.fallback();
  });

  await context.route(/\/api\/collection$/, async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const { releaseId } = req.postDataJSON();
      state.collection.add(releaseId);
      state.calls.push({ kind: "collect", releaseId });
      await json(route, { ok: true, releaseId, collected: true });
      return;
    }
    await route.fallback();
  });

  await context.route(/\/api\/scan$/, async (route) => {
    const body = route.request().postDataJSON();
    state.calls.push({ kind: "scan", mime: body?.mime, bytes: Math.round(((body?.image ?? "").length * 3) / 4) });
    const n = state.calls.filter((c) => c.kind === "scan").length;
    const answer = state.scanAnswers[n - 1] ?? { read: null };
    await json(route, answer);
  });

  return state;
}

export const FAKE = { byId, ALL };
