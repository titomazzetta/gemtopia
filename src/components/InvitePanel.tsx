"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, ApiError, type AdminOverview, type InviteStatus } from "@/client/api";

/**
 * Invites, for admins. Opened from the account menu; full screen on a phone,
 * a card on desktop, closed with × or Escape — the same shape as the pull list.
 *
 * Make a code that lives an hour or a day, copy it (or a ready-to-send
 * message with it), and see what happened to the codes you have made and who
 * is signed up. The code is shown exactly once: the server keeps only a
 * scrambled form of it, so there is nothing to show again later.
 */

const STATUS_STYLE: Record<InviteStatus, string> = {
  live: "border-accent/40 text-accent",
  used: "border-ink-600 text-neutral-300",
  expired: "border-ink-700 text-neutral-600",
  revoked: "border-red-500/30 text-red-300/80",
};

function ago(ms: number, now: number): string {
  const minutes = Math.round((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days} d ago` : new Date(ms).toLocaleDateString();
}

function until(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((ms - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

export function InvitePanel({
  username,
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ id: string; code: string; hours: number; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState<"code" | "message" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await adminApi.overview());
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load invites.");
    }
  }, []);

  // First load. `load` is for refreshing after an action; here the state is
  // only set from the promise's callback, and not at all once closed.
  useEffect(() => {
    let alive = true;
    adminApi
      .overview()
      .then((overview) => {
        if (!alive) return;
        setData(overview);
        setNow(Date.now());
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not load invites.");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Countdowns tick once a minute; nothing here needs more.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

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

  const make = async (hours: 1 | 24) => {
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      const created = await adminApi.create(hours);
      setFresh(created);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not make a code.");
    } finally {
      setBusy(false);
    }
  };

  const message = fresh
    ? `Here's your Gemtopia invite code: ${fresh.code}\n` +
      `It works once, for the next ${fresh.hours === 1 ? "hour" : "24 hours"}. ` +
      `Go to ${window.location.origin}, tap "Have an invite code?", enter it, ` +
      `then sign in with Discogs.`
    : "";

  const copy = async (what: "code" | "message") => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(what === "code" ? fresh.code : message);
      setCopied(what);
    } catch {
      setError("Couldn't reach the clipboard — select the code and copy it by hand.");
    }
  };

  const revoke = async (id: string) => {
    try {
      await adminApi.revoke(id);
      if (fresh?.id === id) setFresh(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not revoke that code.");
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = window.confirm(
      `Remove ${name}?\n\n` +
        "They're signed out everywhere straight away and can't sign back in " +
        "until you give them a new code. Their playlists are kept.",
    );
    if (!ok) return;
    try {
      await adminApi.removeMember(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove that member.");
    }
  };

  const live = data?.invites.filter((i) => i.status === "live").length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 lg:items-center lg:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Invites"
    >
      <div className="flex h-full w-full flex-col bg-ink-950 lg:h-auto lg:max-h-[85vh] lg:max-w-xl lg:rounded-xl lg:border lg:border-ink-700">
        <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Invites</p>
            <h2 className="text-base font-semibold text-neutral-100">Let someone in</h2>
            {data && (
              <p className="mt-0.5 text-[11px] text-neutral-500">
                {data.inviteOnly
                  ? "Invite-only is on. New Discogs accounts need a code."
                  : "Invite-only is off — anyone can sign in. Codes still work."}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close invites"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-700 text-lg text-neutral-300 hover:border-ink-600 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <section className="border-b border-ink-800 px-4 py-4">
            <p className="text-xs text-neutral-400">
              One code, one person, one use. Send it however you like.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([1, 24] as const).map((hours) => (
                <button
                  key={hours}
                  type="button"
                  disabled={busy}
                  onClick={() => void make(hours)}
                  className="h-11 rounded-md border border-ink-700 text-sm text-neutral-200 hover:border-accent/60 hover:text-accent disabled:opacity-40"
                >
                  {hours === 1 ? "Code for 1 hour" : "Code for 24 hours"}
                </button>
              ))}
            </div>

            {fresh && (
              <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
                <p
                  className="select-all text-center font-mono text-3xl font-semibold tracking-[0.2em] text-accent"
                  aria-label={`Invite code ${fresh.code.split("").join(" ")}`}
                >
                  {fresh.code}
                </p>
                <p className="mt-1 text-center text-[11px] text-neutral-500">
                  Works once · expires in {until(fresh.expiresAt, now)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void copy("code")}
                    className="h-10 rounded-md bg-accent text-sm font-semibold text-ink-950"
                  >
                    {copied === "code" ? "Copied" : "Copy code"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy("message")}
                    className="h-10 rounded-md border border-ink-700 text-sm text-neutral-200 hover:border-ink-600"
                  >
                    {copied === "message" ? "Copied" : "Copy message"}
                  </button>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
                  This is the only time it&rsquo;s shown. Gemtopia keeps a scrambled
                  form it can check but can&rsquo;t read back — lose it and just make
                  another.
                </p>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-3 text-xs text-red-300">
                {error}
              </p>
            )}
          </section>

          {data && data.invites.length > 0 && (
            <section className="border-b border-ink-800 px-4 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Your codes <span className="font-normal normal-case tracking-normal">· {live} live of {data.maxLive}</span>
              </h3>
              <ul className="mt-2 divide-y divide-ink-850">
                {data.invites.map((invite) => (
                  <li key={invite.id} className="flex items-center gap-3 py-2 text-xs">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[invite.status]}`}>
                      {invite.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-400">
                      {invite.status === "used" && invite.usedBy
                        ? <>used by <span className="text-neutral-200">{invite.usedBy}</span></>
                        : invite.status === "live"
                          ? `made ${ago(invite.createdAt, now)} · ${until(invite.expiresAt, now)} left`
                          : `made ${ago(invite.createdAt, now)}`}
                    </span>
                    {invite.status === "live" && (
                      <button
                        type="button"
                        onClick={() => void revoke(invite.id)}
                        className="h-8 shrink-0 px-2 text-[11px] text-red-300/90 hover:text-red-200"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data && (
            <section className="px-4 py-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                Members <span className="font-normal normal-case tracking-normal">· {data.members.filter((m) => !m.removedAt).length}</span>
              </h3>
              <ul className="mt-2 divide-y divide-ink-850">
                {data.members.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 py-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${member.removedAt ? "text-neutral-600 line-through" : "text-neutral-200"}`}>
                        {member.username}
                      </span>
                      <span className="block truncate text-[11px] text-neutral-600">
                        {member.invitedBy ? `invited by ${member.invitedBy}` : "from before invites"}
                        {" · "}
                        {member.removedAt ? `removed ${ago(member.removedAt, now)}` : `seen ${ago(member.lastSeenAt, now)}`}
                      </span>
                    </span>
                    {!member.removedAt && member.username.toLowerCase() !== username.toLowerCase() && (
                      <button
                        type="button"
                        onClick={() => void remove(member.id, member.username)}
                        className="h-8 shrink-0 px-2 text-[11px] text-neutral-500 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!data && !error && (
            <p className="p-8 text-center text-sm text-neutral-600">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}
