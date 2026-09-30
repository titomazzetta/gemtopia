"use client";

import { useState } from "react";
import { ApiError, joinApi, setCsrfToken } from "@/client/api";

/**
 * The Join button for a collaboration link. Nothing is joined until it is
 * pressed — the link alone never adds anyone to anything.
 */
export function JoinCard({
  token,
  csrfToken,
  preview,
}: {
  token: string;
  csrfToken: string;
  preview: {
    playlistId: string;
    name: string;
    owner: string;
    tracks: number;
    collaborators: number;
    alreadyIn: boolean;
  };
}) {
  setCsrfToken(csrfToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (playlistId: string) => {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/?playlist=${encodeURIComponent(playlistId)}`;
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await joinApi.join(token);
      open(result.playlistId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't join. Try again.");
      setBusy(false);
    }
  };

  const others = preview.collaborators;

  return (
    <div className="rounded-xl border-2 border-accent-alt/60 bg-ink-900 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-alt">
        Collaborative playlist
      </p>
      <h1 className="mt-1 text-lg font-semibold text-neutral-100">{preview.name}</h1>
      <p className="mt-1 text-sm text-neutral-400">
        by <span className="text-neutral-200">{preview.owner}</span> · {preview.tracks} track
        {preview.tracks === 1 ? "" : "s"}
        {others > 0 && ` · ${others} collaborator${others === 1 ? "" : "s"}`}
      </p>

      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        Joining lets you add, remove and reorder records in this set, and it shows
        up in your playlists with an amber border. Your own collection stays private
        — only the records you add are shared. You can leave any time.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {preview.alreadyIn ? (
        <button
          type="button"
          onClick={() => open(preview.playlistId)}
          className="mt-5 h-11 w-full rounded-md bg-accent text-sm font-semibold text-ink-950"
        >
          You&rsquo;re already on it — open it
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void join()}
          className="mt-5 h-11 w-full rounded-md bg-accent-alt text-sm font-semibold text-ink-950 disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join this playlist"}
        </button>
      )}
    </div>
  );
}
