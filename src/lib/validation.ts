import { z } from "zod";

/**
 * Shared request schemas.
 *
 * Kept in one file so the shape of every accepted payload is auditable at a
 * glance. `.strict()` everywhere: an unexpected property is a rejected
 * request, not a silently ignored one.
 */

export const CLIP_KEY = z
  .string()
  .regex(/^\d{1,12}:[A-Za-z0-9_-]{11}$/, "malformed clip key");

export const playlistItemSchema = z
  .object({
    clipKey: CLIP_KEY,
    releaseId: z.number().int().positive().max(1e9),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string().max(400),
    artist: z.string().max(400),
    releaseTitle: z.string().max(400).default(""),
    year: z.number().int().min(1880).max(2200).nullable().default(null),
  })
  .strict();

export const createPlaylistSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    entries: z.array(playlistItemSchema).max(1000).default([]),
  })
  .strict();

export const updatePlaylistSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    entries: z.array(playlistItemSchema).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.entries !== undefined, {
    message: "nothing to update",
  });

/** One-time import of playlists that were created before the server store. */
export const importPlaylistsSchema = z
  .object({
    playlists: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            entries: z.array(playlistItemSchema).max(1000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

export const trackMetaSchema = z
  .object({
    clipKey: CLIP_KEY,
    bpm: z.number().min(40).max(260).nullable().default(null),
    bpmSource: z.enum(["tap", "auto", "discogs", "manual"]).nullable().default(null),
    bpmConfidence: z.number().min(0).max(1).nullable().default(null),
    musicalKey: z.string().max(8).nullable().default(null),
    rating: z.number().int().min(0).max(5).nullable().default(null),
    cueNote: z.string().max(500).nullable().default(null),
  })
  .strict()
  // A reading without a source is meaningless — and would let a client
  // sidestep the tap-beats-auto precedence rules in the upsert.
  .refine((v) => v.bpm === null || v.bpmSource !== null, {
    message: "bpm requires bpmSource",
  });

export const trackMetaBatchSchema = z
  .object({ entries: z.array(trackMetaSchema).min(1).max(200) })
  .strict();

export const analyseSchema = z
  .object({
    playlistId: z.string().uuid(),
    /** Skip the cache and re-run the traversal. */
    refresh: z.boolean().default(false),
    /**
     * Release ids the user owns, so recommendations can exclude them.
     * Supplied by the client because the collection index lives there.
     */
    ownedReleaseIds: z.array(z.number().int().positive()).max(10_000).default([]),
    wantlistReleaseIds: z.array(z.number().int().positive()).max(10_000).default([]),
  })
  .strict();

export const UUID = z.string().uuid();
