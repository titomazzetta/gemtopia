"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describePlaybackError } from "./playbackErrors";
import {
  describeBlockedPlay,
  describeStall,
  nextPlayAttempt,
  playOutcome,
  shouldSkipOnStall,
  stallVerdict,
  watchdogAction,
  PLAY_CONFIRM_MS,
  START_TIMEOUT_MS,
} from "./playbackWatchdog";

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
const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

/**
 * Ask the browser whether the player's frame is allowed to start audio.
 *
 * The answer comes from Permissions Policy, which is decided by a response
 * header this repo controls — so a `false` here is very often our own bug
 * rather than the viewer's settings, and it is worth asking before blaming
 * either. `featurePolicy` is unevenly implemented, so an unknown answer is
 * treated as permitted: a missing API must not invent a diagnosis.
 */
function autoplayPermitted(): boolean {
  try {
    const policy = (
      document as Document & {
        featurePolicy?: {
          allowsFeature(feature: string, origin?: string): boolean;
        };
      }
    ).featurePolicy;
    if (!policy) return true;
    return policy.allowsFeature("autoplay", PLAYER_ORIGIN);
  } catch {
    return true;
  }
}

/* Minimal typings for the slice of the API we touch. */
export interface YTPlayer {
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

export interface YTNamespace {
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
  load(videoId: string, autoplay: boolean, title?: string): void;
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

  /*
   * Stall detection. Kept in refs, and the two controls are stable callbacks,
   * so the player effect can close over them once without ever rebuilding the
   * iframe — rebuilding it mid-set would be a far worse bug than the one this
   * fixes.
   */
  const stallTimer = useRef<number | null>(null);
  const stallTitle = useRef<string>("");

  /*
   * A request that arrived before the player existed.
   *
   * Building the iframe means fetching YouTube's API script and waiting for
   * `onReady`, which on a cold load is comfortably longer than it takes
   * someone to click the first track they see. `load()` used to return
   * silently in that window: no playback, no error, no change of status, just
   * a track name that lit up and a playhead that stayed at 0:00 — and it
   * cleared up on its own once the player finished arriving, which made it
   * look like something the viewer had done rather than a race.
   *
   * Only the newest request is kept. If someone clicks three records while
   * the player loads, they want the third one, not a burst of three.
   */
  const pendingLoad = useRef<{
    videoId: string;
    autoplay: boolean;
    title: string;
  } | null>(null);

  /*
   * A press of play that arrived before the player existed. Separate from
   * `pendingLoad` because the two are genuinely different requests: one says
   * which record, the other says go. Pressing play while a track is already
   * queued must not be mistaken for choosing a track, and vice versa.
   */
  const pendingPlay = useRef(false);

  /*
   * Whether an explicit press of play was actually obeyed.
   *
   * `playVideo()` returns nothing and throws nothing when the browser refuses
   * it, so a blocked press is indistinguishable from a press that worked
   * until you look at the player a moment later. This is that look.
   */
  const playConfirm = useRef<number | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimer.current !== null) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
  }, []);

  const clearPlayConfirm = useCallback(() => {
    if (playConfirm.current !== null) {
      window.clearTimeout(playConfirm.current);
      playConfirm.current = null;
    }
  }, []);

  const armStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimer.current = window.setTimeout(() => {
      stallTimer.current = null;

      const allowed = autoplayPermitted();
      const verdict = stallVerdict(allowed);

      setStatus("error");
      setError(describeStall(stallTitle.current, allowed));

      // Only a dead upload advances. Skipping a policy block would skip the
      // whole crate, one record every eight seconds, for a reason that has
      // nothing to do with any of them.
      if (shouldSkipOnStall(verdict)) onUnplayableRef.current();
    }, START_TIMEOUT_MS);
  }, [clearStallTimer]);

  // Neither timer may outlive the component.
  useEffect(() => clearStallTimer, [clearStallTimer]);
  useEffect(() => clearPlayConfirm, [clearPlayConfirm]);

  /**
   * Press play, and check a second later that it took.
   *
   * Every route to playback funnels through here — the transport button, the
   * spacebar, and a queued press replayed on ready — so there is one place
   * where "it did nothing" can be noticed, rather than three places where it
   * cannot.
   */
  const requestPlay = useCallback(() => {
    /*
     * A local declaration rather than a second `useCallback`, because it
     * recurses: the retry is the same request with the attempt count moved
     * on. A memoised callback cannot name itself.
     */
    function attemptPlay(attempt: number) {
      const player = playerRef.current;
      if (!player) {
        // Held, not dropped. The press is honoured the moment the player
        // lands, replayed from onReady.
        pendingPlay.current = true;
        setStatus("loading");
        return;
      }

      player.playVideo();
      clearPlayConfirm();

      playConfirm.current = window.setTimeout(() => {
        playConfirm.current = null;
        const state = playerRef.current?.getPlayerState();
        if (state === undefined) return;
        if (playOutcome(state) === "started") return;

        /*
         * The press did nothing. Ask again before concluding anything: a
         * player whose video module is still waking up drops the first press
         * silently, and that is indistinguishable from a refusal except that
         * it does not happen twice.
         */
        if (nextPlayAttempt(attempt) === "retry") {
          attemptPlay(attempt + 1);
          return;
        }

        // Asked twice, ignored twice. Not an error about the record.
        setStatus("paused");
        setError(describeBlockedPlay());
      }, PLAY_CONFIRM_MS);
    }

    attemptPlay(0);
  }, [clearPlayConfirm]);

  /*
   * The part that needs a live player. Split out so `onReady` can replay a
   * request that arrived too early without duplicating any of it.
   *
   * Declared above the player effect rather than beside `load`, because
   * `onReady` closes over it: the React Compiler rejects a `useCallback`
   * read before its own declaration, on the grounds that the earlier reader
   * can never see a later version of it. It is right, and the ordering is
   * the whole fix.
   */
  const startPlayback = useCallback(
    (videoId: string, autoplay: boolean, title: string) => {
      const player = playerRef.current;
      if (!player) return;
      stallTitle.current = title;

      if (autoplay) {
        player.loadVideoById(videoId);
        // Armed only when playback was actually asked for. A cued clip is
        // sitting there on purpose and is not stuck.
        armStallTimer();
      } else {
        clearStallTimer();
        player.cueVideoById(videoId);
      }
    },
    [armStallTimer, clearStallTimer],
  );

  useEffect(() => {
    let disposed = false;

    loadApi()
      .then((YT) => {
        if (disposed || !containerRef.current) return;

        playerRef.current = new YT.Player(containerRef.current, {
          host: PLAYER_ORIGIN,
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

              const queued = pendingLoad.current;
              pendingLoad.current = null;
              if (queued) {
                // Deliberately still autoplays. The gesture that asked for
                // this happened seconds ago and has not been withdrawn;
                // honouring it late is what the viewer is waiting for.
                startPlayback(queued.videoId, queued.autoplay, queued.title);
              }

              // A press of play that landed before the player did. Replayed
              // after the load above, so it acts on the right record.
              if (pendingPlay.current) {
                pendingPlay.current = false;
                requestPlay();
              }
            },
            onStateChange: (event: { data: number }) => {
              if (disposed) return;
              const state = event.data;

              /*
               * The watchdog. `onError` only covers failures YouTube reports;
               * an unavailable upload draws its own card inside the iframe and
               * reports nothing at all, which left the player sitting at 0:00
               * forever with a track that was never going to play.
               */
              const action = watchdogAction(state);
              if (action === "clear") clearStallTimer();
              else if (action === "extend") armStallTimer();

              // Any sign of life answers the question the confirm timer was
              // about to ask, including a press on the player's own controls.
              if (
                state === YT.PlayerState.PLAYING ||
                state === YT.PlayerState.BUFFERING
              ) {
                clearPlayConfirm();
              }

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
            onError: (event: { data: number }) => {
              if (disposed) return;

              /*
               * The code is read rather than assumed. This handler used to
               * take no argument and treat every failure as "the video is
               * unplayable, skip it" — true of 100/101/150, false of 5, the
               * HTML5 player error Safari throws on clips that play fine in
               * Chrome. Skipping on 5 walks the queue marking good records
               * bad, one per browser.
               */
              clearStallTimer();
              const failure = describePlaybackError(event.data);
              setStatus("error");
              setError(failure.message);
              if (failure.permanent) onUnplayableRef.current();
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

  const load = useCallback(
    (videoId: string, autoplay: boolean, title = "") => {
      setError(null);
      setCurrentTime(0);
      setDuration(0);
      setStatus("loading");

      if (!playerRef.current) {
        // Queue it and show "loading" rather than doing nothing at all. The
        // status is honest: the clip really is on its way.
        pendingLoad.current = { videoId, autoplay, title };
        return;
      }

      startPlayback(videoId, autoplay, title);
    },
    [startPlayback],
  );

  const play = requestPlay;

  const pause = useCallback(() => {
    clearPlayConfirm();
    playerRef.current?.pauseVideo();
  }, [clearPlayConfirm]);

  const toggle = useCallback(() => {
    if (status === "playing") {
      clearPlayConfirm();
      playerRef.current?.pauseVideo();
      return;
    }
    // No early return on a missing player: requestPlay holds the press.
    requestPlay();
  }, [status, requestPlay, clearPlayConfirm]);

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
