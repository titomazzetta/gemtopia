"use client";

/**
 * "Open on YouTube": the clip that's playing, in YouTube itself.
 *
 * Asked for by a friend who keeps his wants-of-single-tracks as a YouTube
 * list — Discogs has no per-track wantlist, so the link is where his notes
 * go. It is a plain link in a new tab: nothing is embedded, nothing is
 * fetched, and the id is the one Discogs gave us, already checked to be a
 * YouTube id (lib/discogs.ts); it is checked again here because a URL is
 * being built from it.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeWatchUrl(videoId: string | null | undefined): string | null {
  return videoId && YOUTUBE_ID.test(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

export function YouTubeLink({
  videoId,
  variant = "wide",
  className = "",
}: {
  videoId: string | null | undefined;
  /** `wide` matches the player sheet's buttons; `text` is a small inline link. */
  variant?: "wide" | "text";
  className?: string;
}) {
  const href = youtubeWatchUrl(videoId);
  if (!href) return null;
  const base =
    variant === "wide"
      ? "flex w-full items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 py-2 text-xs font-medium text-neutral-300 hover:border-ink-600 hover:text-white"
      : "inline-flex items-center gap-1 text-[11px] text-neutral-500 underline-offset-2 hover:text-neutral-200 hover:underline";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this clip on YouTube, in a new tab"
      className={`${base} ${className}`}
    >
      {/* A plain "opens elsewhere" arrow, not a brand mark. */}
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
      Open on YouTube
    </a>
  );
}
