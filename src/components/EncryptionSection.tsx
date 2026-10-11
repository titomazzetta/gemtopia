"use client";

import { useEffect, useState } from "react";
import { adminApi, ApiError, type EncryptionAction, type EncryptionStatus } from "@/client/api";
import { Lock } from "./Icons";

/**
 * Chat encryption, for admins: the admin panel's key-management corner.
 *
 * Shows what the server reports — whether a master key is configured, its
 * public id (an HMAC fingerprint, not the key), how many messages are sealed
 * and how many still sit in plaintext from before encryption, and where every
 * playlist key stands in a rotation — with the two operations that change
 * any of it. The server never sends key material or message text here.
 */
export function EncryptionSection() {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<EncryptionAction | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi
      .encryption()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not load encryption status.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const run = async (action: EncryptionAction) => {
    setBusy(action);
    setError(null);
    setSaid(null);
    try {
      // Each call does a few seconds of work; keep going until it's done.
      let total = 0;
      for (let round = 0; round < 50; round += 1) {
        const { result, status: next } = await adminApi.encryptionAction(action);
        setStatus(next);
        total += action === "seal-older" ? result.sealed ?? 0 : result.rewrapped ?? 0;
        if ((result.remaining ?? 0) === 0) break;
      }
      setSaid(
        action === "seal-older"
          ? `Sealed ${total} older message${total === 1 ? "" : "s"}.`
          : `Re-wrapped ${total} playlist key${total === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-t border-ink-800 px-4 py-4">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        <Lock className="h-3 w-3" /> Chat encryption
      </h3>

      {status && !status.configured && (
        <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200">
          CHAT_MASTER_KEY isn&rsquo;t set on this deployment, so chat is refusing new
          messages rather than storing them unencrypted. Add it in the host&rsquo;s
          environment settings and redeploy.
        </p>
      )}

      {status && status.configured && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-neutral-500">Master key</dt>
          <dd className="truncate font-mono text-neutral-300" title="Public fingerprint (HMAC), not the key">
            {status.currentKeyId}
            {status.retiredKeyIds.length > 0 && (
              <span className="ml-2 font-sans text-neutral-500">
                + {status.retiredKeyIds.length} retired
              </span>
            )}
          </dd>

          <dt className="text-neutral-500">Messages</dt>
          <dd className="text-neutral-300">
            {status.messages.sealed.toLocaleString()} sealed
            {status.messages.plaintext > 0 ? (
              <span className="text-amber-300"> · {status.messages.plaintext.toLocaleString()} from before encryption</span>
            ) : (
              <span className="text-neutral-500"> · none in plaintext</span>
            )}
          </dd>

          <dt className="text-neutral-500">Playlist keys</dt>
          <dd className="text-neutral-300">
            {status.playlistKeys.total.toLocaleString()}
            {status.playlistKeys.retired > 0 && (
              <span className="text-amber-300"> · {status.playlistKeys.retired} on a retired master key</span>
            )}
            {status.playlistKeys.missing > 0 && (
              <span className="text-red-300"> · {status.playlistKeys.missing} on a master key that&rsquo;s no longer configured</span>
            )}
          </dd>

          <dt className="text-neutral-500">Database</dt>
          <dd className={status.plaintextRefused ? "text-accent" : "text-neutral-400"}>
            {/* The lock is the schema block's last step (db/schema.sql); it
                only takes once nothing is plaintext and something is sealed. */}
            {status.plaintextRefused
              ? "refuses any message without ciphertext"
              : status.messages.plaintext > 0
                ? "accepts the older plaintext form until it's sealed and locked"
                : status.messages.sealed === 0
                  ? "not locked yet: it can lock once the first sealed message is in"
                  : "ready to lock: run the “Chat encryption at rest” SQL block again"}
          </dd>
        </dl>
      )}

      {status?.configured && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy !== null || status.messages.plaintext === 0}
            onClick={() => void run("seal-older")}
            className="h-10 rounded-md border border-ink-700 text-xs text-neutral-200 hover:border-accent/60 hover:text-accent disabled:opacity-40"
          >
            {busy === "seal-older" ? "Sealing…" : "Seal older messages"}
          </button>
          <button
            type="button"
            disabled={busy !== null || status.playlistKeys.retired === 0}
            onClick={() => void run("rewrap")}
            className="h-10 rounded-md border border-ink-700 text-xs text-neutral-200 hover:border-accent/60 hover:text-accent disabled:opacity-40"
            title="After rotating CHAT_MASTER_KEY: re-wrap every playlist key under the new one"
          >
            {busy === "rewrap" ? "Re-wrapping…" : "Re-wrap keys"}
          </button>
        </div>
      )}

      {said && <p className="mt-2 text-xs text-accent">{said}</p>}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {!status && !error && <p className="mt-2 text-xs text-neutral-600">Loading…</p>}
    </section>
  );
}
