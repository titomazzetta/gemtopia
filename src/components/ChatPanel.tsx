"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Playlist } from "@/lib/types";
import { ApiError, chatApi } from "@/client/api";
import {
  describeNote,
  groupRuns,
  mergeLatest,
  prependOlder,
  type KnownRecord,
} from "@/client/chatView";
import { useFinePointer } from "@/client/useFinePointer";
import { MAX_MESSAGE_CHARS, canDeleteMessage, messageLength } from "@/lib/chat";
import { ChatIcon, SendIcon, Users } from "./Icons";

/** How often an open chat asks for new messages. */
const POLL_MS = 4_000;

/** The counter appears once this few characters are left. */
const COUNTER_FROM = 100;

function time(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Chat for the people building a set together — the order, the blends, what
 * to pull. Telegram-shaped: your messages on the right, everyone else's on
 * the left under their name, a divider for each day.
 *
 * Messages are plain text, drawn as React text: nothing anyone types is ever
 * parsed as HTML, Markdown or a link. The rules for what may be stored are
 * in lib/chat.ts and the database; this is only the view.
 *
 * Full screen above the player bar on a phone, a panel on the right on
 * desktop; × or Escape closes.
 */
export function ChatPanel({
  playlist,
  me,
  onClose,
  onPeople,
  onSeen,
  onGone,
  lookup,
  onPlayRecord,
}: {
  playlist: Playlist;
  me: string;
  onClose: () => void;
  /** Open the people on this playlist (join link, who's in, leave). */
  onPeople: () => void;
  /** The newest message has been seen; the unread badge can go. */
  onSeen: () => void;
  /** This person no longer has the playlist (removed, or it was deleted). */
  onGone: () => void;
  /** Length and BPM this browser knows for a record, to fill in notes. */
  lookup?: (clipKey: string) => KnownRecord | null;
  /** Play a record from the set — tapping its name in a note. */
  onPlayRecord?: (clipKey: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const finePointer = useFinePointer();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottom = useRef(true);
  const olderAnchor = useRef<number | null>(null);
  const alive = useRef(true);
  const loadedRef = useRef(false);

  const callbacks = useRef({ onClose, onSeen, onGone });
  useEffect(() => {
    callbacks.current = { onClose, onSeen, onGone };
  }, [onClose, onSeen, onGone]);

  const people = useMemo(() => {
    const everyone = [playlist.owner, ...playlist.collaborators];
    return everyone
      .filter((name, i) => everyone.indexOf(name) === i)
      .map((name) => (name.toLowerCase() === me.toLowerCase() ? "you" : name));
  }, [playlist.owner, playlist.collaborators, me]);

  const refresh = useCallback(
    () =>
      chatApi
        .list(playlist.id)
        .then((page) => {
          if (!alive.current) return;
          setMessages((existing) => mergeLatest(existing, page.messages));
          // Whether there is history before this page is decided once, on
          // opening; after that "Earlier messages" keeps its own count.
          if (!loadedRef.current) setHasMore(page.hasMore);
          loadedRef.current = true;
          setLoaded(true);
        })
        .catch((e: unknown) => {
          if (!alive.current) return;
          if (e instanceof ApiError && e.status === 404) {
            callbacks.current.onGone();
            return;
          }
          // A missed poll is not worth a banner; the next one will try again.
          if (!loadedRef.current) setError("Couldn't load the chat. It will keep trying.");
        }),
    [playlist.id],
  );

  // Load, then poll while open and on screen.
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // The newest message on screen has been seen: say so to the server, so the
  // unread badge clears on every device, not just this one.
  const newest = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!newest) return;
    callbacks.current.onSeen();
    chatApi.markRead(playlist.id, newest).catch(() => {
      /* the next open marks it again */
    });
  }, [newest, playlist.id]);

  // Stay pinned to the bottom as messages arrive, unless you've scrolled up
  // to read; keep your place when an older page is added above.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (olderAnchor.current !== null) {
      el.scrollTop = el.scrollHeight - olderAnchor.current;
      olderAnchor.current = null;
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Escape closes; the page behind doesn't scroll.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") callbacks.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // On a phone the keyboard covers the bottom of the screen; lift the panel
  // above it so the box you're typing in stays visible.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardInset(covered > 80 ? covered : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // The box grows with what you type, up to about five lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft]);

  const length = messageLength(draft.trim());
  const left = MAX_MESSAGE_CHARS - length;
  const canSend = length > 0 && left >= 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const message = await chatApi.post(playlist.id, draft);
      stickToBottom.current = true;
      setMessages((existing) =>
        existing.some((m) => m.id === message.id) ? existing : [...existing, message],
      );
      setDraft("");
      void refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        callbacks.current.onGone();
        return;
      }
      setError(e instanceof ApiError ? e.message : "That didn't send. Try again.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const remove = async (message: ChatMessage) => {
    setSelected(null);
    setError(null);
    const before = messages;
    setMessages((existing) => existing.filter((m) => m.id !== message.id));
    try {
      await chatApi.remove(playlist.id, message.id);
    } catch (e) {
      setMessages(before);
      setError(e instanceof ApiError ? e.message : "Couldn't delete that.");
    }
  };

  const loadOlder = async () => {
    const oldest = messages[0]?.id;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await chatApi.list(playlist.id, oldest);
      const el = scrollRef.current;
      olderAnchor.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((existing) => prependOlder(existing, page.messages));
      setHasMore(page.hasMore);
    } catch {
      setError("Couldn't load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const runs = useMemo(() => groupRuns(messages), [messages]);

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex justify-end bg-black/60"
      style={{ bottom: keyboardInset > 0 ? `${keyboardInset}px` : "var(--mobile-bar-h, 0px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Chat: ${playlist.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full flex-col bg-ink-950 lg:max-w-md lg:border-l lg:border-accent-alt/40">
        <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <ChatIcon className="mt-1 h-4 w-4 shrink-0 text-accent-alt" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-neutral-100">{playlist.name}</h2>
            <p className="truncate text-[11px] text-neutral-500">{people.join(", ")}</p>
          </div>
          <button
            type="button"
            onClick={onPeople}
            aria-label="People on this playlist"
            title="People on this playlist"
            className="flex items-center gap-1 rounded-md border border-accent-alt/50 px-2 py-1 text-[11px] text-accent-alt hover:bg-accent-alt/10"
          >
            <Users className="h-3.5 w-3.5" />
            {people.length}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="-mr-1 rounded-md px-2 py-1 text-lg leading-none text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
          aria-live="polite"
          aria-relevant="additions"
        >
          {hasMore && (
            <div className="mb-3 text-center">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="rounded-full border border-ink-700 px-3 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
              >
                {loadingOlder ? "Loading…" : "Earlier messages"}
              </button>
            </div>
          )}

          {loaded && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <p className="text-sm text-neutral-300">No messages yet.</p>
              <p className="mt-1 text-xs text-neutral-500">
                Talk through the order, a blend that needs work, or who&apos;s bringing which record.
              </p>
            </div>
          )}

          {runs.map((run) => (
            <div key={run.key}>
              {run.day && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-ink-800 px-2.5 py-0.5 text-[10px] font-medium text-neutral-400">
                    {run.day}
                  </span>
                </div>
              )}
              {run.note ? (
                <div className="my-2 flex flex-col items-center gap-1">
                  {run.messages.map((message) => {
                    const note = describeNote(
                      message,
                      message.meta?.clipKey ? lookup?.(message.meta.clipKey) : null,
                    );
                    const playable =
                      note.clipKey !== null && onPlayRecord !== undefined && lookup?.(note.clipKey) != null;
                    return (
                      <div
                        key={message.id}
                        className="max-w-[92%] rounded-xl bg-ink-900 px-3 py-1.5 text-center text-[11px] leading-snug text-neutral-400 ring-1 ring-ink-800"
                      >
                        <span className="font-medium text-accent-alt/90">{note.who}</span> {note.verb}
                        {note.title && (
                          <>
                            {" "}
                            {playable ? (
                              <button
                                type="button"
                                onClick={() => onPlayRecord?.(note.clipKey!)}
                                title="Play it"
                                className="font-medium text-neutral-100 underline decoration-ink-600 underline-offset-2 hover:text-accent"
                              >
                                {note.title}
                              </button>
                            ) : (
                              <span className="font-medium text-neutral-200">{note.title}</span>
                            )}
                            {note.artist && <span> — {note.artist}</span>}
                          </>
                        )}
                        <span className="ml-1.5 text-[10px] text-neutral-600">{time(message.at)}</span>
                        {note.details.length > 0 && (
                          <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-neutral-500">
                            {note.details.join(" · ")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
              <div className={`mb-2 flex flex-col ${run.mine ? "items-end" : "items-start"}`}>
                {!run.mine && (
                  <span className="mb-0.5 ml-2 text-[11px] font-medium text-accent-alt/90">
                    {run.author ?? "Former member"}
                  </span>
                )}
                {run.messages.map((message) => {
                  const deletable = canDeleteMessage(playlist.role, message.mine);
                  const isSelected = selected === message.id;
                  return (
                    <div
                      key={message.id}
                      className={`mb-0.5 flex max-w-[85%] items-center gap-2 ${run.mine ? "flex-row-reverse" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelected(isSelected ? null : message.id)}
                        aria-expanded={deletable ? isSelected : undefined}
                        className={`select-text rounded-2xl px-3 py-1.5 text-left text-sm leading-snug ${
                          run.mine
                            ? "rounded-br-md bg-accent/15 text-neutral-100 ring-1 ring-accent/25"
                            : "rounded-bl-md bg-ink-800 text-neutral-100"
                        } ${isSelected ? "ring-2 ring-accent-alt/60" : ""}`}
                      >
                        <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {message.body}
                        </span>
                        <span className="ml-2 inline-block translate-y-0.5 text-[10px] text-neutral-500">
                          {time(message.at)}
                        </span>
                      </button>
                      {isSelected && deletable && (
                        <button
                          type="button"
                          onClick={() => void remove(message)}
                          className="shrink-0 rounded-md border border-red-500/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                        >
                          {message.mine ? "Delete" : "Remove"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="shrink-0 border-t border-ink-800 px-4 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <form
          className="flex shrink-0 items-end gap-2 border-t border-ink-800 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends where there's a keyboard; on a phone it's a new
                // line and the button sends, as in every messaging app.
                if (finePointer && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Message"
              aria-label="Message"
              autoComplete="off"
              spellCheck
              className="block w-full resize-none rounded-2xl border border-ink-700 bg-ink-900 px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-accent-alt/60 focus:outline-none lg:text-sm"
            />
            {left <= COUNTER_FROM && (
              <span
                className={`pointer-events-none absolute -top-5 right-2 text-[10px] tabular-nums ${
                  left < 0 ? "text-red-400" : "text-neutral-500"
                }`}
                aria-live="polite"
              >
                {left < 0 ? `${-left} over` : `${left} left`}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-alt text-ink-950 transition-opacity disabled:opacity-30"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
