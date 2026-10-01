"use client";

import { useEffect, useRef, useState } from "react";
import { useFinePointer } from "@/client/useFinePointer";
import { Mark } from "./Mark";

const SEEN_KEY = "gt_welcome_v1";

/**
 * Whether this browser has been through the welcome tour. Kept on the device
 * only; it decides nothing but whether to show four cards, so a cleared
 * browser just means seeing them once more. Wrapped because storage can be
 * off (private mode) — then the tour shows, and closing it still works.
 */
export function welcomeSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "done");
  } catch {
    /* storage off: it will show again next time, which is harmless */
  }
}

/**
 * Four cards on a first visit: what this is, how to hear it, how to build a
 * set, and digging and back-to-backs. Short on purpose — the rest is in `?`.
 * Worded for the device (drag on a desktop, + on a phone).
 */
export function WelcomeTour({ username, onClose }: { username: string; onClose: () => void }) {
  const fine = useFinePointer();
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  const finish = () => {
    markSeen();
    onClose();
  };

  useEffect(() => {
    nextRef.current?.focus();
  }, [step]);

  const steps: Array<{ title: string; body: string[] }> = [
    {
      title: `Welcome, ${username}`,
      body: [
        "Gemtopia turns your Discogs collection into a crate you can hear, sort and build sets from — on a train, in a hotel, anywhere but the shelf.",
        "Your records are loading now. Discogs allows 60 requests a minute, so a big collection takes a while the first time — anything already loaded plays straight away.",
      ],
    },
    {
      title: "Hear it",
      body: [
        "Shuffle plays what's on screen. Cut the crate down first with filters: style, label, decade, tempo.",
        "Tap the artist or record of what's playing to hear the whole release. Tracks with no YouTube clip still show, marked record only — tap one to log its BPM while you play the real record.",
      ],
    },
    {
      title: "Build the set",
      body: [
        fine
          ? "Drag any record onto a playlist in the sidebar, or press A (or +) to pick one."
          : "Tap + on any record, or on the player bar while it plays, to put it in a playlist.",
        "Set prep checks every transition against your decks' pitch range, and Whole list shows the set at once — the list you take to the shelf.",
      ],
    },
    {
      title: "Dig, and go back-to-back",
      body: [
        fine
          ? "Press D on anything playing: what else you own that connects to it, then the records beyond your crate."
          : "Dig from this, on what's playing: what else you own that connects to it, then the records beyond your crate.",
        "Collaborate turns a playlist into a shared one for a B2B, with a chat beside it. Press ? any time for how everything works.",
      ],
    },
  ];
  const last = step === steps.length - 1;
  const current = steps[step]!;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") finish();
        }}
        className="w-full max-w-md rounded-t-2xl border border-ink-700 bg-ink-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 text-neutral-500">
          <Mark size={18} />
          <span className="text-[10px] font-semibold uppercase tracking-wider">
            {step + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={finish}
            className="ml-auto text-[12px] text-neutral-500 hover:text-neutral-200"
          >
            Skip
          </button>
        </div>

        <h2 id="welcome-title" className="mt-3 text-lg font-semibold text-neutral-100">
          {current.title}
        </h2>
        {current.body.map((line) => (
          <p key={line} className="mt-2 text-[13px] leading-relaxed text-neutral-400">
            {line}
          </p>
        ))}

        <div className="mt-5 flex items-center gap-2">
          <div className="flex gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-accent" : "bg-ink-600"}`} />
            ))}
          </div>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="ml-auto rounded-lg border border-ink-700 px-3 py-2 text-sm text-neutral-300"
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={() => (last ? finish() : setStep((s) => s + 1))}
            className={`${step > 0 ? "" : "ml-auto"} rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink-950`}
          >
            {last ? "Start digging" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
