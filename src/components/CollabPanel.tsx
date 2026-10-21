"use client";

import { useEffect, useRef, useState } from "react";
import type { Playlist } from "@/lib/types";
import { ApiError, playlistsApi } from "@/client/api";
import { ROLE_LABEL } from "@/client/collabView";
import { MEMBER_ROLES, type MemberRole } from "@/lib/roles";
import { Check, Users } from "./Icons";

/**
 * Working on a playlist together.
 *
 * Owner: make a join link, copy or share it, replace it, turn it off, see who
 * has joined, set what each of them may do (lib/roles.ts), and remove them.
 * Collaborator: see who else is on it and at what level, and leave.
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
  // "Link copied" on the button for a moment after it worked, so the press
  // shows on the button itself and not only in the line below it.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

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
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
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

  const setRole = (username: string, role: MemberRole) =>
    run(async () => {
      await playlistsApi.setMemberRole(playlist.id, username, role);
      const { name, says } = ROLE_LABEL[role];
      setNote(`${username}: ${name.toLowerCase()} — ${says.charAt(0).toLowerCase()}${says.slice(1)}`);
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

  /** Everyone on it with their level; the owner first when you aren't them. */
  const people: Array<{ name: string; role: MemberRole | "owner" }> = owner
    ? playlist.members
    : [{ name: playlist.owner, role: "owner" }, ...playlist.members];
  const mine = playlist.role;

  return (
    <div
      className="fixed inset-0 z-60 flex items-stretch justify-center bg-black/70 lg:items-center lg:p-8"
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
              {owner
                ? "Your playlist"
                : `${playlist.owner}'s playlist — ${
                    mine === "full" ? "you have full control" : mine === "viewer" ? "you're listening" : "you can add to it"
                  }`}
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
                Anyone with a Gemtopia account who opens it can press Join, and then add
                records, reorder, and take out the ones they added. Below, give someone{" "}
                <b className="font-medium text-neutral-200">Full control</b> to take out anyone&rsquo;s
                records and rename the set, or <b className="font-medium text-neutral-200">Listen</b> to
                let them play it and chat but change nothing. Only you can delete it, or change
                who&rsquo;s on it. Everyone&rsquo;s collection stays private — only records added here are shared.
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
                      className={`flex h-10 items-center justify-center gap-1.5 rounded-md text-sm font-semibold text-ink-950 transition-colors disabled:opacity-50 ${
                        copied ? "bg-accent" : "bg-accent-alt"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="h-4 w-4" />
                          Link copied
                        </>
                      ) : (
                        "Copy link"
                      )}
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
              {mine === "full"
                ? `You have full control of what's in this set: add, reorder, take out anyone's records, rename it. Only ${playlist.owner} can delete it or change who's on it.`
                : mine === "viewer"
                  ? `You can play this set and talk in its chat. ${playlist.owner} decides who can change it — ask if you'd like to add to it.`
                  : "You can add records, reorder, and take out the ones you added. Everything you change is saved for everyone on it."}
            </p>
          )}

          {/* Always in the page, so a screen reader hears each new note. */}
          <p role="status" className="text-xs text-accent-alt [&:not(:empty)]:mt-3">
            {note}
          </p>
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
                {people.map(({ name, role }) => (
                  <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-neutral-200">
                      {name}
                      {name.toLowerCase() === me.toLowerCase() && (
                        <span className="text-[11px] text-neutral-500"> · you</span>
                      )}
                      {!owner && (
                        <span className="text-[11px] text-neutral-500">
                          {" "}
                          · {role === "owner" ? "owner" : ROLE_LABEL[role].name.toLowerCase()}
                        </span>
                      )}
                    </span>
                    {owner && role !== "owner" && (
                      <>
                        {/*
                          What this person may do. Three levels, one tap each;
                          the change is said in the set's chat, so everyone on
                          it knows who can take out what.

                          Pressed buttons rather than radios on purpose: a
                          radio group moves its choice with the arrow keys,
                          and each choice here is a save and a line in the
                          chat, so arrowing past "Add" on the way to "Full
                          control" would announce both. Each one is its own
                          tab stop and acts only on Enter, Space or a tap.
                          aria-disabled rather than disabled while a save is
                          out, so the button pressed keeps keyboard focus.
                        */}
                        <div
                          role="group"
                          aria-label={`What ${name} can do`}
                          className="flex shrink-0 overflow-hidden rounded-full border border-ink-700 text-[11px]"
                        >
                          {MEMBER_ROLES.map((level) => (
                            <button
                              key={level}
                              type="button"
                              aria-pressed={role === level}
                              aria-disabled={busy}
                              title={ROLE_LABEL[level].says}
                              onClick={() => {
                                if (!busy && role !== level) void setRole(name, level);
                              }}
                              className={`min-h-11 px-3 sm:min-h-8 sm:px-2.5 ${
                                role === level
                                  ? level === "full"
                                    ? "bg-accent-alt font-semibold text-ink-950"
                                    : "bg-ink-700 font-semibold text-neutral-100"
                                  : "text-neutral-400 hover:text-neutral-100"
                              }`}
                            >
                              {ROLE_LABEL[level].name}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(name)}
                          className="h-11 shrink-0 px-2 text-[11px] text-neutral-500 hover:text-red-300 sm:h-8"
                        >
                          Remove
                        </button>
                      </>
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
