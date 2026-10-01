"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFinePointer } from "@/client/useFinePointer";
import { SHORTCUTS } from "./Shortcuts";
import { ChatIcon, Compass, Disc, ListIcon, Metronome, Plus, Share, Shuffle, Users } from "./Icons";

/**
 * "How it works" — what `?` (and the ? button) opens.
 *
 * It used to be the keyboard list alone, which explained the keys to people
 * who already knew the features and nothing to anyone else. Now it says how
 * each part of the app is used, in the words a DJ would use, worded for the
 * device you're holding (drag on a desktop, + on a phone), with the keys as
 * the second tab and a way to replay the welcome tour.
 */

interface Section {
  icon: ReactNode;
  title: string;
  body: (fine: boolean) => ReactNode;
}

const k = (key: string) => (
  <kbd className="rounded border border-ink-600 bg-ink-850 px-1 font-mono text-[10px] text-neutral-200">{key}</kbd>
);

export const HELP: ReadonlyArray<Section> = [
  {
    icon: <Disc className="h-4 w-4" />,
    title: "Your crate",
    body: () => (
      <>
        Your Discogs collection (or wantlist), synced to this device. The first sync is slow — Discogs
        allows 60 requests a minute — but anything already loaded plays straight away. Tracks with no
        YouTube clip are still listed, marked <b>record only</b> with a disc: tap one for its side,
        length and a tap pad.
      </>
    ),
  },
  {
    icon: <Shuffle className="h-4 w-4" />,
    title: "Listen and filter",
    body: (fine) => (
      <>
        <b>Shuffle</b> plays what&apos;s on screen. Cut it down first with filters — style, label,
        decade, tempo. Tap the artist or record of what&apos;s playing to hear the whole release in
        running order.{fine && <> Click a column header to sort.</>}
      </>
    ),
  },
  {
    icon: <Plus className="h-4 w-4" />,
    title: "Build a set",
    body: (fine) => (
      <>
        {fine ? (
          <>
            <b>Drag</b> any row onto a playlist in the sidebar, or press {k("A")} / the <b>+</b> to pick
            one.
          </>
        ) : (
          <>
            Tap <b>+</b> on a row, or on the player bar while something plays.
          </>
        )}{" "}
        In a playlist, <b>Whole list</b> shows the set at once — {fine ? "drag" : "press and hold"} a
        record to move it. <b>Set prep</b> checks every transition against your decks&apos; pitch range.
      </>
    ),
  },
  {
    icon: <Metronome className="h-4 w-4" />,
    title: "BPM",
    body: (fine) => (
      <>
        Tap along with {fine ? <>{k("T")} or </> : null}<b>TAP</b>, or press <b>Detect</b> (Chrome reads
        the tab&apos;s audio). <b>Measure</b> plays through everything without a BPM and logs it. Your
        tempos are yours — nobody else sees them.
      </>
    ),
  },
  {
    icon: <Compass className="h-4 w-4" />,
    title: "Dig",
    body: (fine) => (
      <>
        {fine ? <>{k("D")} or </> : null}<b>Dig from this</b> on what&apos;s playing: what else you own
        that connects to it, then beyond your crate — other versions, the remixer, the label, the era.
        Heart a record to put it on your Discogs wantlist.
      </>
    ),
  },
  {
    icon: <Users className="h-4 w-4" />,
    title: "Back-to-back",
    body: () => (
      <>
        <b>Collaborate</b> on a playlist makes a join link. Shared playlists are amber; everyone adds and
        reorders, you take out only what you added, and each row says who brought it.
      </>
    ),
  },
  {
    icon: <ChatIcon className="h-4 w-4" />,
    title: "Chat",
    body: () => (
      <>
        Every shared playlist has a chat for the order and the blends, with small notes when records
        are added or taken out. The number on the chat button, the playlist and by the logo is what&apos;s new since you last read it — on any device.
      </>
    ),
  },
  {
    icon: <ListIcon className="h-4 w-4" />,
    title: "Take it with you",
    body: (fine) => (
      <>
        {fine
          ? "Install it as an app from the browser's address bar (Chrome, Edge), or Add to Dock in Safari."
          : "Share → Add to Home Screen, and it opens full screen like an app."}{" "}
        Playlists are private to your account unless you share them.
      </>
    ),
  },
  {
    icon: <Share className="h-4 w-4" />,
    title: "Share",
    body: () => (
      <>
        The share icon on a row sends the record&apos;s Discogs page. A playlist can have a read-only
        link anyone can open and play; turn it off and the link is dead.
      </>
    ),
  },
];

export function HelpPanel({
  onClose,
  onReplayTour,
}: {
  onClose: () => void;
  onReplayTour: () => void;
}) {
  const fine = useFinePointer();
  const [tab, setTab] = useState<"how" | "keys">("how");
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-ink-700 bg-ink-900 shadow-2xl sm:rounded-xl"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-800 px-4 py-3">
          <h2 id="help-title" className="text-sm font-semibold text-neutral-100">
            How it works
          </h2>
          <div role="tablist" className="ml-1 flex rounded-md border border-ink-700 p-0.5 text-[11px]">
            {(["how", "keys"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`rounded px-2 py-0.5 ${tab === value ? "bg-ink-700 text-neutral-100" : "text-neutral-400"}`}
              >
                {value === "how" ? "Features" : "Keyboard"}
              </button>
            ))}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-ink-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-100"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "how" ? (
            <ul className="space-y-3.5">
              {HELP.map((section) => (
                <li key={section.title} className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-accent">{section.icon}</span>
                  <div>
                    <h3 className="text-[13px] font-medium text-neutral-100">{section.title}</h3>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-400 [&_b]:font-medium [&_b]:text-neutral-200">
                      {section.body(fine)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-[12px]">
              {SHORTCUTS.map(({ keys, action }) => (
                <div key={action} className="contents">
                  <dt className="flex gap-1">
                    {keys.map((key) => (
                      <kbd
                        key={key}
                        className="min-w-[1.6rem] rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-center font-mono text-[11px] text-neutral-200"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="text-neutral-400">{action}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="shrink-0 border-t border-ink-800 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onReplayTour}
            className="text-[12px] text-accent underline-offset-2 hover:underline"
          >
            Replay the welcome tour
          </button>
        </div>
      </div>
    </div>
  );
}
