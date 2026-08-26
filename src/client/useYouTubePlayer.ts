"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thin wrapper around the YouTube IFrame Player API.
 *
 * A note on the "audio only" requirement, because it shaped this file:
 * YouTube's API terms require an embedded player to keep a viewport of at
 * least 200x200 px and forbid covering it with overlays. Extracting the audio
 * stream and dropping the video is a terms violation and would get an app
 * pulled. So Gemtopia keeps a real, visible, minimum-size player — it just
 * demotes it to the role of album art in the corner, and drives everything
 * through custom transport controls. You get the Bandcamp flow without
 * building something that breaks the moment anyone looks at it.
 */

const API_SRC = "https://www.youtube.com/iframe_api";

/* Minimal typings for the slice of the API we touch. */
interface YTPlayer {
  loadVideoById(id: string, start?: number): void;
  cueVideoById(id: string, start?: number): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: Record<string, unknown>,
  ) => YTPlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
      else reject(new Error("YouTube API loaded without a Player constructor"));
    };

    // Injected by our own nonce-trusted bundle, so CSP `strict-dynamic`
    // extends trust to it without listing youtube.com in script-src.
    const script = document.createElement("script");
    script.src = API_SRC;
    script.async = true;
    script.onerror = () =>
      reject(new Error("Could not load the YouTube player."));
    document.head.appendChild(script);
  });

  return apiPromise;
}

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface PlayerApi {
  ready: boolean;
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  volume: number;
  error: string | null;
  load(videoId: string, autoplay: boolean): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  nudge(seconds: number): void;
  setVolume(value: number): void;
}

export function useYouTubePlayer(options: {
  onEnded: () => void;
  onUnplayable: () => void;
}): { api: PlayerApi; containerRef: React.RefObject<HTMLDivElement | null> } {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const pollRef = useRef<number | null>(null);

  // Latest-callback refs so the player is constructed exactly once while its
  // event handlers still see current state. Written in an effect, not during
  // render, so React's concurrent rendering can never observe a torn value.
  const onEndedRef = useRef(options.onEnded);
  const onUnplayableRef = useRef(options.onUnplayable);
  useEffect(() => {
    onEndedRef.current = options.onEnded;
    onUnplayableRef.current = options.onUnplayable;
  }, [options.onEnded, options.onUnplayable]);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(80);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    loadApi()
      .then((YT) => {
        if (disposed || !containerRef.current) return;

        playerRef.current = new YT.Player(containerRef.current, {
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: {
            // No related videos from other channels, no branding, no annotations.
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            playsinline: 1,
            controls: 0,
            disablekb: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (disposed) return;
              setReady(true);
              playerRef.current?.setVolume(volume);
            },
            onStateChange: (event: { data: number }) => {
              if (disposed) return;
              const state = event.data;
              if (state === YT.PlayerState.ENDED) {
                setStatus("ended");
                onEndedRef.current();
              } else if (state === YT.PlayerState.PLAYING) {
                setStatus("playing");
                setError(null);
                setDuration(playerRef.current?.getDuration() ?? 0);
              } else if (state === YT.PlayerState.PAUSED) {
                setStatus("paused");
              } else if (state === YT.PlayerState.BUFFERING) {
                setStatus("loading");
              }
            },
            onError: () => {
              if (disposed) return;
              // 100/101/150: removed, private, or embedding disabled.
              // Common enough in a big crate that we just move on.
              setStatus("error");
              setError("This clip can't be played — skipping.");
              onUnplayableRef.current();
            },
          },
        });
      })
      .catch((err: Error) => {
        if (!disposed) {
          setStatus("error");
          setError(err.message);
        }
      });

    return () => {
      disposed = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      try {
        playerRef.current?.destroy();
      } catch {
        /* player already gone */
      }
      playerRef.current = null;
    };
    // Mount once. `volume` is read at ready-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the playhead at 4 Hz — smooth enough to scrub against, cheap enough
  // that it does not wake the CPU constantly on a laptop at a gig.
  useEffect(() => {
    if (!ready) return;
    pollRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      try {
        setCurrentTime(player.getCurrentTime() ?? 0);
        const d = player.getDuration() ?? 0;
        if (d > 0) setDuration(d);
      } catch {
        /* player mid-teardown */
      }
    }, 250);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [ready]);

  const load = useCallback((videoId: string, autoplay: boolean) => {
    const player = playerRef.current;
    if (!player) return;
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setStatus("loading");
    if (autoplay) player.loadVideoById(videoId);
    else player.cueVideoById(videoId);
  }, []);

  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (status === "playing") player.pauseVideo();
    else player.playVideo();
  }, [status]);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(Math.max(0, seconds), true);
    setCurrentTime(Math.max(0, seconds));
  }, []);

  const nudge = useCallback(
    (seconds: number) => {
      const player = playerRef.current;
      if (!player) return;
      seek((player.getCurrentTime() ?? 0) + seconds);
    },
    [seek],
  );

  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(value)));
    setVolumeState(clamped);
    playerRef.current?.setVolume(clamped);
  }, []);

  return {
    containerRef,
    api: {
      ready,
      status,
      currentTime,
      duration,
      volume,
      error,
      load,
      play,
      pause,
      toggle,
      seek,
      nudge,
      setVolume,
    },
  };
}
