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

/**
 * `tracks` are the ones with a clip. `total` is every track in the set, so the
 * counter can say why "2 of 5" sits under a heading that says six.
 */
export function SharedPlayer({ tracks, total }: { tracks: SharedTrack[]; total: number }) {
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
        // Fills the box below, which is what holds the minimum size.
        width: "100%",
        height: "100%",
        videoId: tracks[0]?.videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          // The share token is in this page's URL. `origin` is sent to YouTube
          // regardless; the site's Referrer-Policy is
          // strict-origin-when-cross-origin, so a request to another site
          // carries the origin at most. The path — and with it the token —
          // never leaves in a header.
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

  /*
   * Load a track when the index moves to it — and only then.
   *
   * The player is built with the first track already cued, so there is
   * nothing to load until someone skips or a track ends. This used to skip
   * only the very first render, and then ran again the moment the player
   * reported ready: `loadVideoById` on the first track, which is "load and
   * play". Wherever the browser allowed it, opening a share link started the
   * music by itself. A link opened from a message is not a tap on play.
   */
  const loadedIndex = useRef(0);
  useEffect(() => {
    const track = tracks[index];
    if (!ready || !track || loadedIndex.current === index) return;
    loadedIndex.current = index;
    playerRef.current?.loadVideoById(track.videoId);
  }, [index, ready, tracks]);

  const toggle = useCallback(() => {
    if (!playerRef.current) return;
    if (playing) playerRef.current.pauseVideo();
    else playerRef.current.playVideo();
  }, [playing]);

  const current = tracks[index];
  if (!current) return null;

  const recordOnly = Math.max(0, total - tracks.length);

  return (
    <div className="mb-8 rounded-lg border border-ink-800 bg-ink-900 p-3">
      {/*
        Stacked on a phone, side by side from a tablet up. Beside a 200px
        video a 393px-wide phone had 107px left for the title, three buttons
        and a caption, which is how the buttons came to be 26px and the
        caption came to hang out of the card.
      */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {/*
          YouTube's API terms require the player stay visible and unobscured,
          at 200 by 200 pixels or more. The box holds that size on every
          screen: 16:9 where that is tall enough, and never under 200px high.
          It sits here doing the job album art would.
        */}
        <div className="aspect-video min-h-[200px] w-full shrink-0 overflow-hidden rounded-sm bg-black sm:w-[356px]">
          <div ref={mountRef} className="h-full w-full" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-0.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-100">
              {current.title}
            </p>
            <p className="truncate text-xs text-neutral-400">
              {current.artist}
              <span className="text-neutral-500"> — {current.releaseTitle}</span>
            </p>
            {/*
              Counts what plays, and says what doesn't: a set of six with one
              record-only track read "1 / 5" under a heading that said six.
            */}
            <p className="mt-1 text-[11px] text-neutral-500">
              Clip {index + 1} of {tracks.length}
              {recordOnly > 0 && <> · {recordOnly} record only</>}
            </p>
          </div>

          <div>
            {/* The sizes of the app's own bar: 40px skips, a 44px play. */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => advance(-1)}
                className="grid h-10 w-10 place-items-center rounded-full text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
                aria-label="Previous track"
              >
                <Prev className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggle}
                disabled={!ready}
                className="grid h-11 w-11 place-items-center rounded-full bg-accent text-ink-950 transition-transform hover:scale-105 disabled:opacity-40"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => advance(1)}
                className="grid h-10 w-10 place-items-center rounded-full text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
                aria-label="Next track"
              >
                <Next className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-500">Plays straight through.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
