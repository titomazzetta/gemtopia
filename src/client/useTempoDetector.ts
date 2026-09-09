"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { estimateTempo, type TempoEstimate } from "./tempo";

/**
 * Live BPM detection from the audio the browser is already playing.
 *
 * Why this shape: the YouTube player runs in a cross-origin iframe, so Web
 * Audio cannot reach its media element — `createMediaElementSource` needs an
 * element from our own document, and the IFrame API exposes no samples. What
 * *is* reachable is the tab's audio on its way to the speakers, via
 * `getDisplayMedia({ audio: true })`. The user grants it once per session and
 * every track that plays afterwards gets analysed automatically.
 *
 * Nothing is downloaded, stored, or re-transmitted. The only thing that leaves
 * this module is a number.
 *
 * Browser support: tab audio capture is Chromium-only (Chrome, Edge, Brave,
 * Arc). Firefox and Safari do not implement it, so those users fall back to
 * microphone capture — which works fine off speakers — or to tap tempo.
 */

const GRID_HZ = 100;
const HOP_SECONDS = 1 / GRID_HZ;
/** Analysis window. Long enough for a stable reading, short enough to react. */
const WINDOW_SECONDS = 14;
const WINDOW_SAMPLES = WINDOW_SECONDS * GRID_HZ;
/** How often to re-estimate. */
const ESTIMATE_INTERVAL_MS = 2_000;
/** Consecutive agreeing estimates required before we commit a reading. */
const STABLE_REQUIRED = 3;
const STABLE_TOLERANCE_BPM = 1.5;

export type CaptureSource = "tab" | "mic";

export type DetectorStatus =
  | "unsupported"
  | "idle"
  | "requesting"
  | "listening"
  | "denied"
  | "error";

export interface TempoDetector {
  status: DetectorStatus;
  /** Rolling estimate, updated every couple of seconds. */
  live: TempoEstimate | null;
  /** Estimate that has held steady long enough to be worth storing. */
  committed: TempoEstimate | null;
  error: string | null;
  source: CaptureSource | null;
  start(source: CaptureSource): Promise<void>;
  stop(): void;
  /** Drop accumulated audio. Called on track change. */
  reset(): void;
}

function supportsTabCapture(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/** Either capture route will do; tap tempo covers the rest. */
function captureAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    typeof navigator.mediaDevices?.getDisplayMedia === "function" ||
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Is the feature disabled by *our own* response header?
 *
 * `Permissions-Policy` failures surface as NotAllowedError — indistinguishable
 * from the user dismissing the picker — so ask the document directly. The API
 * is `permissionsPolicy` in current specs and `featurePolicy` in older
 * Chromium; neither exists everywhere, and an absent API is not evidence of a
 * block, so an unknown answer is treated as "not blocked".
 */
function blockedByPolicy(kind: "tab" | "mic"): boolean {
  const feature = kind === "tab" ? "display-capture" : "microphone";
  const policy = (
    document as Document & {
      permissionsPolicy?: { allowsFeature(name: string): boolean };
      featurePolicy?: { allowsFeature(name: string): boolean };
    }
  );
  const api = policy.permissionsPolicy ?? policy.featurePolicy;
  if (!api?.allowsFeature) return false;
  try {
    return !api.allowsFeature(feature);
  } catch {
    return false;
  }
}

export function useTempoDetector(options: {
  /** Fires once per track when a reading stabilises. */
  onCommit: (estimate: TempoEstimate) => void;
}): TempoDetector {
  // Capability is known at first render — deciding it in an effect would
  // render "idle" for a frame and then correct itself.
  const [status, setStatus] = useState<DetectorStatus>(() =>
    captureAvailable() ? "idle" : "unsupported",
  );
  const [live, setLive] = useState<TempoEstimate | null>(null);
  const [committed, setCommitted] = useState<TempoEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<CaptureSource | null>(null);

  const onCommitRef = useRef(options.onCommit);
  useEffect(() => {
    onCommitRef.current = options.onCommit;
  }, [options.onCommit]);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const estimateTimerRef = useRef<number | null>(null);

  // Timestamped flux samples, drained into a uniform grid at analysis time.
  const rawRef = useRef<Array<{ t: number; v: number }>>([]);
  const previousSpectrumRef = useRef<Float32Array | null>(null);
  const stableRef = useRef<{ bpm: number; hits: number }>({ bpm: 0, hits: 0 });

  const teardown = useCallback(() => {
    if (sampleTimerRef.current) window.clearInterval(sampleTimerRef.current);
    if (estimateTimerRef.current) window.clearInterval(estimateTimerRef.current);
    sampleTimerRef.current = null;
    estimateTimerRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    analyserRef.current = null;

    rawRef.current = [];
    previousSpectrumRef.current = null;
    stableRef.current = { bpm: 0, hits: 0 };
  }, []);

  useEffect(() => teardown, [teardown]);

  const reset = useCallback(() => {
    rawRef.current = [];
    previousSpectrumRef.current = null;
    stableRef.current = { bpm: 0, hits: 0 };
    setLive(null);
    setCommitted(null);
  }, []);

  /** One flux sample: how much low-end energy *increased* since last frame. */
  const takeSample = useCallback(() => {
    const analyser = analyserRef.current;
    const context = contextRef.current;
    if (!analyser || !context) return;

    const spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(spectrum);

    const previous = previousSpectrumRef.current;
    previousSpectrumRef.current = spectrum;
    if (!previous) return;

    const binHz = context.sampleRate / 2 / analyser.frequencyBinCount;
    // Kick drum territory. This is what carries the beat in dance music.
    const lowMax = Math.max(2, Math.floor(250 / binHz));
    const fullMax = Math.min(spectrum.length, Math.floor(6000 / binHz));

    let lowFlux = 0;
    let fullFlux = 0;

    for (let i = 1; i < fullMax; i++) {
      // dB values; -Infinity for silent bins.
      const now = Math.max(-100, spectrum[i]!);
      const then = Math.max(-100, previous[i]!);
      const rise = now - then;
      if (rise <= 0) continue;
      if (i < lowMax) lowFlux += rise;
      fullFlux += rise;
    }

    // Weighted towards the low end, but not blind to snares and hats — those
    // are what disambiguate a tempo from its half.
    const value = lowFlux * 0.7 + fullFlux * 0.3;

    rawRef.current.push({ t: context.currentTime, v: value });

    // Keep a little more than the analysis window.
    const cutoff = context.currentTime - (WINDOW_SECONDS + 2);
    while (rawRef.current.length > 0 && rawRef.current[0]!.t < cutoff) {
      rawRef.current.shift();
    }
  }, []);

  /** Resample the timestamped flux onto a uniform grid and estimate. */
  const runEstimate = useCallback(() => {
    const context = contextRef.current;
    const raw = rawRef.current;
    if (!context || raw.length < 200) return;

    const endTime = raw[raw.length - 1]!.t;
    const startTime = Math.max(raw[0]!.t, endTime - WINDOW_SECONDS);
    const span = endTime - startTime;
    if (span < 8) return;

    const length = Math.min(WINDOW_SAMPLES, Math.floor(span * GRID_HZ));
    const grid = new Float32Array(length);

    // Linear interpolation onto the uniform grid. The samples arrive on a
    // timer, so they are close to evenly spaced but not exactly — using the
    // AudioContext clock rather than wall time keeps the drift out.
    let cursor = 0;
    for (let i = 0; i < length; i++) {
      const t = startTime + i * HOP_SECONDS;
      while (cursor < raw.length - 2 && raw[cursor + 1]!.t < t) cursor += 1;

      const a = raw[cursor]!;
      const b = raw[cursor + 1] ?? a;
      const dt = b.t - a.t;
      grid[i] = dt <= 0 ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / dt;
    }

    const estimate = estimateTempo(grid, HOP_SECONDS);
    if (!estimate) return;

    setLive(estimate);

    // Commit only once a reading has held still. A single confident-looking
    // estimate during an intro is exactly how you end up cataloguing the
    // wrong number forever.
    const stable = stableRef.current;
    if (Math.abs(estimate.bpm - stable.bpm) <= STABLE_TOLERANCE_BPM) {
      stable.hits += 1;
      stable.bpm = (stable.bpm * (stable.hits - 1) + estimate.bpm) / stable.hits;
    } else {
      stable.bpm = estimate.bpm;
      stable.hits = 1;
    }

    if (stable.hits >= STABLE_REQUIRED && estimate.confidence >= 0.35) {
      const settled: TempoEstimate = {
        bpm: Math.round(stable.bpm * 10) / 10,
        confidence: estimate.confidence,
      };
      setCommitted(settled);
      onCommitRef.current(settled);
      // Require a fresh run of agreement before committing again.
      stable.hits = 0;
    }
  }, []);

  const start = useCallback(
    async (requested: CaptureSource) => {
      teardown();
      setError(null);
      setStatus("requesting");

      try {
        let stream: MediaStream;

        if (requested === "tab") {
          if (!supportsTabCapture()) {
            throw new Error(
              "This browser cannot capture tab audio. Use Chrome or Edge, or switch to microphone.",
            );
          }
          // Chromium only hands over tab audio when video is also requested.
          // We stop the video track immediately — we never look at pixels.
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          stream.getVideoTracks().forEach((track) => {
            track.stop();
            stream.removeTrack(track);
          });

          if (stream.getAudioTracks().length === 0) {
            throw new Error(
              'No audio was shared. Re-run and tick "Share tab audio" in the picker.',
            );
          }
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
        }

        // If the user revokes sharing from the browser's own UI.
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
          teardown();
          setStatus("idle");
          setSource(null);
        });

        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        // No smoothing: we want the real frame-to-frame change.
        analyser.smoothingTimeConstant = 0;

        context.createMediaStreamSource(stream).connect(analyser);
        // Note the analyser is *not* connected to the destination — this is a
        // tap, not a monitor path. Nothing is played back.

        streamRef.current = stream;
        contextRef.current = context;
        analyserRef.current = analyser;

        // Oversample relative to the analysis grid, then resample down; that
        // keeps onset timing sharp despite timer jitter.
        sampleTimerRef.current = window.setInterval(takeSample, 8);
        estimateTimerRef.current = window.setInterval(
          runEstimate,
          ESTIMATE_INTERVAL_MS,
        );

        setSource(requested);
        setStatus("listening");
      } catch (caught) {
        teardown();
        const message =
          caught instanceof Error ? caught.message : "Could not start capture.";
        const denied =
          caught instanceof DOMException &&
          (caught.name === "NotAllowedError" || caught.name === "AbortError");

        setStatus(denied ? "denied" : "error");
        setError(
          denied
            ? blockedByPolicy(requested)
              ? // Worth spelling out. A Permissions-Policy block and a user
                // pressing Cancel both arrive as NotAllowedError, so "not
                // allowed" was true and useless: it sent you to Chrome's
                // settings when the page's own response header was refusing.
                `This page's Permissions-Policy blocks ${
                  requested === "tab" ? "display-capture" : "microphone"
                }. That is a server header, not a browser setting — set it to (self) in next.config.ts.`
              : "Audio capture was not allowed. If you cancelled the picker, press Detect again — and tick \u201cShare tab audio\u201d."
            : message,
        );
      }
    },
    [teardown, takeSample, runEstimate],
  );

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setSource(null);
    setLive(null);
  }, [teardown]);

  return { status, live, committed, error, source, start, stop, reset };
}
