"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Next, Pause, Play, Prev } from "./Icons";
import type { YTPlayer } from "@/client/useYouTubePlayer";

/**
 * The player on a shared set list.
 *
 * **This component makes no network requests to Gemtopia at all.** Every track
 * it needs was rendered into the page by the server, and the only thing it
 * talks to is YouTube's iframe — the same thing any embed on any blog talks
 * to. That is deliberate and it is the security property worth stating: a
 * share link is a credential, and the page it opens has no authenticated
 * surface for that credential to be spent against.
 *
 * Concretely, from this page there is no route to:
 *   - the owner's Discogs account, collection or wantlist,
 *   - the owner's other playlists, or their identity,
 *   - any write path anywhere in the application.
 *
 * There is no session, no CSRF token, and no `fetch` in this file. A visitor
 * holding the link can read this set and play it. Nothing else is reachable,
 * because nothing else is wired up.
 */

interface SharedTrack {
  clipKey: string;
  videoId: string;
  releaseId: number;
  title: string;
  artist: string;
  releaseTitle: string;
  year: number | null;
}

/*
 * The `Window.YT` global is declared once, in useYouTubePlayer. Redeclaring it
 * here with a narrower shape is a type error, and rightly so — two files
 * disagreeing about the same global is how a runtime surprise starts.
 */
const API_SRC = "https://www.youtube.com/iframe_api";

/** Load the IFrame API once per page, whoever asks first. */
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();

  return new Promise((resolve) => {
    const existing = document.querySelector(`script[src="${API_SRC}"]`);
    const previous = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };

    if (!existing) {
      const script = document.createElement("script");
      script.src = API_SRC;
      document.head.appendChild(script);
    }
  });
}

export function SharedPlayer({ tracks }: { tracks: SharedTrack[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);

  // Read by the API's event callbacks, which are created once and would
  // otherwise close over a stale index.
  const indexRef = useRef(0);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const advance = useCallback(
    (delta: number) => {
      setIndex((current) => {
        const next = current + delta;
        if (next < 0) return tracks.length - 1;
        if (next >= tracks.length) return 0;
        return next;
      });
    },
    [tracks.length],
  );

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount || tracks.length === 0) return;

    void loadApi().then(() => {
      if (cancelled || !window.YT?.Player) return;

      playerRef.current = new window.YT.Player(mount, {
        // youtube-nocookie: YouTube's own reduced-tracking host. It still sets
        // storage on playback, but nothing before the visitor presses play.
        host: "https://www.youtube-nocookie.com",
        videoId: tracks[0]?.videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          // The share token is in this page's URL. `origin` is sent to YouTube
          // regardless, but the global Referrer-Policy is `no-referrer`, so
          // the full URL — and with it the token — never leaves in a header.
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onStateChange: (event: { data: number }) => {
            if (cancelled) return;
            // 1 playing, 2 paused, 0 ended.
            if (event.data === 1) setPlaying(true);
            if (event.data === 2) setPlaying(false);
            if (event.data === 0) {
              setPlaying(false);
              if (indexRef.current < tracks.length - 1) advance(1);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [tracks, advance]);

  // Load whichever track the index points at, after the first render.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const track = tracks[index];
    if (!ready || !track) return;
    playerRef.current?.loadVideoById(track.videoId);
  }, [index, ready, tracks]);

  const toggle = useCallback(() => {
    if (!playerRef.current) return;
    if (playing) playerRef.current.pauseVideo();
    else playerRef.current.playVideo();
  }, [playing]);

  const current = tracks[index];
  if (!current) return null;

  return (
    <div className="mb-8 rounded-lg border border-ink-800 bg-ink-900 p-3">
      <div className="flex gap-3">
        {/*
          YouTube's API terms require the player stay visible at a minimum
          size and unobscured. It sits here doing the job album art would.
        */}
        <div className="w-[200px] shrink-0 overflow-hidden rounded bg-black">
          <div ref={mountRef} className="aspect-video w-full" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-100">
              {current.title}
            </p>
            <p className="truncate text-xs text-neutral-500">
              {current.artist}
              <span className="text-neutral-700"> — {current.releaseTitle}</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-neutral-700">
              {index + 1} / {tracks.length}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => advance(-1)}
              className="rounded p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-neutral-100"
              aria-label="Previous track"
            >
              <Prev className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={!ready}
              className="rounded-full bg-accent p-2 text-ink-950 transition-transform hover:scale-105 disabled:opacity-40"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => advance(1)}
              className="rounded p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-neutral-100"
              aria-label="Next track"
            >
              <Next className="h-3.5 w-3.5" />
            </button>

            <span className="ml-2 text-[10px] text-neutral-700">
              plays straight through
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
