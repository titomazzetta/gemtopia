"use client";

import { useRef, useState } from "react";
import type { Playlist } from "@/lib/types";
import { Lock, Play, Plus, Shuffle, Trash } from "./Icons";

export function PlaylistPanel({
  playlists,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onPlay,
  onExport,
  onImport,
}: {
  playlists: Playlist[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPlay: (id: string, shuffled: boolean) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    onCreate(name);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={submit} className="flex gap-1.5 border-b border-ink-800 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={80}
          placeholder="New playlist name…"
          className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs placeholder:text-neutral-600"
          aria-label="New playlist name"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="shrink-0 rounded-md bg-accent px-2.5 text-ink-950 disabled:opacity-30"
          title="Create playlist"
        >
          <Plus />
        </button>
      </form>

      <div className="flex-1 overflow-y-auto">
        {playlists.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-600">
            No playlists yet. Build one while you listen — hit{" "}
            <kbd className="rounded bg-ink-800 px-1 font-mono">A</kbd> on
            anything you like.
          </p>
        ) : (
          <ul>
            {playlists.map((playlist) => {
              const active = playlist.id === activeId;
              return (
                <li
                  key={playlist.id}
                  className={`group border-b border-ink-850 ${
                    active ? "bg-accent/10" : "hover:bg-ink-850"
                  }`}
                >
                  <div className="flex items-center gap-1 px-3 py-2">
                    {editingId === playlist.id ? (
                      <input
                        autoFocus
                        defaultValue={playlist.name}
                        maxLength={80}
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (value) onRename(playlist.id, value);
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-xs"
                        aria-label="Playlist name"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(active ? null : playlist.id)}
                        onDoubleClick={() => setEditingId(playlist.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span
                          className={`block truncate text-xs ${
                            active ? "font-semibold text-accent" : "text-neutral-200"
                          }`}
                        >
                          {playlist.name}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-neutral-600">
                          <Lock className="h-2.5 w-2.5" />
                          {playlist.items.length} clip
                          {playlist.items.length === 1 ? "" : "s"}
                        </span>
                      </button>
                    )}

                    <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => onPlay(playlist.id, false)}
                        title="Play in order"
                        className="rounded p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-accent"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onPlay(playlist.id, true)}
                        title="Play shuffled"
                        className="rounded p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-accent"
                      >
                        <Shuffle className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(`Delete playlist "${playlist.name}"?`)
                          ) {
                            onDelete(playlist.id);
                          }
                        }}
                        title="Delete playlist"
                        className="rounded p-1.5 text-neutral-500 hover:bg-ink-800 hover:text-red-400"
                      >
                        <Trash className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-1.5 border-t border-ink-800 px-3 pt-2 text-[10px] leading-relaxed text-neutral-600">
        <Lock className="h-3 w-3 shrink-0" />
        Every playlist is private to your Discogs account. Nothing here is
        readable by another signed-in user, and there is no public URL.
      </p>

      <div className="flex gap-2 border-t border-ink-800 p-3 text-[11px]">
        <button
          type="button"
          onClick={onExport}
          disabled={playlists.length === 0}
          className="flex-1 rounded-md border border-ink-700 py-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
        >
          Export
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 rounded-md border border-ink-700 py-1.5 text-neutral-400 hover:text-neutral-100"
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
