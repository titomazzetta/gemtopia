"use client";

import { useEffect, useRef, useState } from "react";
import type { Playlist } from "@/lib/types";
import { ApiError, playlistsApi } from "@/client/api";
import { Users } from "./Icons";

/**
 * Working on a playlist together.
 *
 * Owner: make a join link, copy or share it, replace it, turn it off, and see
 * and remove who has joined. Collaborator: see who else is on it, and leave.
 * Same shape as the pull list and the invite panel — full screen on a phone,
 * a card on desktop, × or Escape to close.
 */
export function CollabPanel({
  playlist,
  me,
  onClose,
  onChanged,
  onLeft,
}: {
  playlist: Playlist;
  me: string;
  onClose: () => void;
  /** Something about membership or the link changed; reload playlists. */
  onChanged: () => void;
  /** This person just left; the playlist is no longer theirs to show. */
  onLeft: () => void;
}) {
  const owner = playlist.role === "owner";
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The existing link, so copying it again doesn't break the one already sent.
  useEffect(() => {
    if (!owner || !playlist.joinLinkOn) return;
    let alive = true;
    playlistsApi
      .joinLink(playlist.id)
      .then((result) => {
        if (alive) setUrl(result.url);
      })
      .catch(() => {
        if (alive) setError("Couldn't load the link.");
      });
    return () => {
      alive = false;
    };
  }, [owner, playlist.id, playlist.joinLinkOn]);

  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setNote("Link copied. Anyone with a Gemtopia account who opens it can join.");
    } catch {
      setNote("Select the link above and copy it.");
    }
  };

  const makeLink = (replacing: boolean) =>
    run(async () => {
      if (
        replacing &&
        !window.confirm("Make a new link? The old one stops working. People already in stay in.")
      ) {
        return;
      }
      const result = await playlistsApi.setJoinLink(playlist.id, true);
      setUrl(result.url);
      if (result.url) await copy(result.url);
      onChanged();
    });

  const turnOff = () =>
    run(async () => {
      if (!window.confirm("Turn the join link off? Nobody new can join with it. People already in stay in.")) {
        return;
      }
      await playlistsApi.setJoinLink(playlist.id, false);
      setUrl(null);
      setNote("Link turned off.");
      onChanged();
    });

  const share = (link: string) =>
    run(async () => {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: `Help build “${playlist.name}” on Gemtopia`,
            text: `Join my Gemtopia playlist “${playlist.name}” and add records to it:`,
            url: link,
          });
          return;
        } catch {
          // Cancelled, or not allowed here: fall through to copying.
        }
      }
      await copy(link);
    });

  const remove = (username: string) =>
    run(async () => {
      if (!window.confirm(`Remove ${username} from “${playlist.name}”? The records they added stay.`)) {
        return;
      }
      await playlistsApi.removeCollaborator(playlist.id, username);
      onChanged();
    });

  const leave = () =>
    run(async () => {
      if (!window.confirm(`Leave “${playlist.name}”? It disappears from your playlists. The records you added stay in it.`)) {
        return;
      }
      await playlistsApi.removeCollaborator(playlist.id, me);
      onLeft();
    });

  const people = owner ? playlist.collaborators : [playlist.owner, ...playlist.collaborators];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 lg:items-center lg:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Collaborate: ${playlist.name}`}
    >
      <div className="flex h-full w-full flex-col bg-ink-950 lg:h-auto lg:max-h-[85vh] lg:max-w-lg lg:rounded-xl lg:border-2 lg:border-accent-alt/50">
        <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent-alt">
              <Users className="h-3 w-3" />
              Collaborate
            </p>
            <h2 className="truncate text-base font-semibold text-neutral-100">{playlist.name}</h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {owner ? "Your playlist" : `${playlist.owner}'s playlist — you're a collaborator`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-700 text-lg text-neutral-300 hover:border-ink-600 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {owner ? (
            <section>
              <p className="text-xs leading-relaxed text-neutral-400">
                Send a join link to plan a back-to-back set, or build a list together.
                Anyone with a Gemtopia account who opens it can press Join, and then
                add, remove and reorder records. Only you can rename or delete it.
                Everyone&rsquo;s collection stays private — only records added here are shared.
              </p>

              {url ? (
                <div className="mt-4 rounded-lg border border-accent-alt/40 bg-accent-alt/5 p-3">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="Join link"
                    className="w-full truncate rounded-md border border-ink-700 bg-ink-900 px-2 py-2 font-mono text-[11px] text-neutral-200"
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void copy(url)}
                      className="h-10 rounded-md bg-accent-alt text-sm font-semibold text-ink-950 disabled:opacity-50"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void share(url)}
                      className="h-10 rounded-md border border-ink-700 text-sm text-neutral-200 hover:border-ink-600 disabled:opacity-50"
                    >
                      Share…
                    </button>
                  </div>
                  <div className="mt-2 flex justify-between text-[11px]">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void makeLink(true)}
                      className="text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-200"
                    >
                      New link
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void turnOff()}
                      className="text-red-300/80 hover:text-red-200"
                    >
                      Turn link off
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || (playlist.joinLinkOn && url === null && !error)}
                  onClick={() => void makeLink(false)}
                  className="mt-4 h-11 w-full rounded-md bg-accent-alt text-sm font-semibold text-ink-950 disabled:opacity-50"
                >
                  {playlist.joinLinkOn && !error ? "Loading link…" : "Create a join link"}
                </button>
              )}
            </section>
          ) : (
            <p className="text-xs leading-relaxed text-neutral-400">
              You can add, remove and reorder records here. Everything you change is
              saved for everyone on it.
            </p>
          )}

          {note && <p className="mt-3 text-xs text-accent-alt">{note}</p>}
          {error && (
            <p role="alert" className="mt-3 text-xs text-red-300">
              {error}
            </p>
          )}

          <section className="mt-6">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {owner ? "Collaborators" : "On this playlist"}{" "}
              <span className="font-normal normal-case tracking-normal">· {people.length}</span>
            </h3>
            {people.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-600">Nobody has joined yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-850">
                {people.map((name) => (
                  <li key={name} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-neutral-200">
                      {name}
                      {!owner && name === playlist.owner && (
                        <span className="text-[11px] text-neutral-500"> · owner</span>
                      )}
                      {name.toLowerCase() === me.toLowerCase() && (
                        <span className="text-[11px] text-neutral-500"> · you</span>
                      )}
                    </span>
                    {owner && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(name)}
                        className="h-8 shrink-0 px-2 text-[11px] text-neutral-500 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!owner && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void leave()}
              className="mt-6 h-10 w-full rounded-md border border-red-500/30 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              Leave this playlist
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
