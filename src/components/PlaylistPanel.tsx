"use client";

import { useRef, useState } from "react";
import type { Playlist } from "@/lib/types";
import { isClipDrag, readClipDrag } from "@/client/clipDrag";
import { isCollabPlaylist, collabLine } from "@/client/collabView";
import { Link, Lock, Play, Plus, Shuffle, Trash, UnreadBadge, Users } from "./Icons";

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
  onShare,
  sharedIds,
  onDropClip,
  onCollaborate,
  me,
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
  /** Mint or revoke a read-only link. See repo.setPlaylistShare. */
  onShare: (id: string, shared: boolean) => void;
  /** Ids that currently have a live share link. */
  sharedIds: Set<string>;
  /**
   * A record dragged from the crate or a dig lane and dropped on a playlist.
   * Desktop only in practice; omitted, the rows are not drop targets.
   */
  onDropClip?: (playlistId: string, clipKey: string) => void;
  /** Open the collaborate panel for a playlist. */
  onCollaborate?: (id: string) => void;
  /** The signed-in Discogs username, so "you" can be left out of names. */
  me: string;
}) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The playlist a record is being dragged over, so it can light up. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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
              const collab = isCollabPlaylist(playlist);
              const owner = playlist.role === "owner";
              const line = collabLine(playlist, me);
              return (
                <li
                  key={playlist.id}
                  onDragOver={(event) => {
                    if (!onDropClip || !isClipDrag(event.dataTransfer)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    if (dropTarget !== playlist.id) setDropTarget(playlist.id);
                  }}
                  onDragLeave={(event) => {
                    // Leaving for a child element is not leaving the row.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDropTarget((current) => (current === playlist.id ? null : current));
                  }}
                  onDrop={(event) => {
                    setDropTarget(null);
                    const key = readClipDrag(event.dataTransfer);
                    if (!onDropClip || key === null) return;
                    event.preventDefault();
                    onDropClip(playlist.id, key);
                  }}
                  // Amber edge: this set is open to other people. It shows
                  // the moment a join link is out, not only once someone joins.
                  className={`group border-b border-l-2 border-b-ink-850 ${
                    collab ? "border-l-accent-alt" : "border-l-transparent"
                  } ${
                    dropTarget === playlist.id
                      ? "bg-accent/15 outline outline-1 -outline-offset-1 outline-accent/60"
                      : active
                        ? "bg-accent/10"
                        : "hover:bg-ink-850"
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
                        onDoubleClick={() => {
                          // Only the owner names the set.
                          if (owner) setEditingId(playlist.id);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span
                            className={`min-w-0 truncate text-xs ${
                              active ? "font-semibold text-accent" : "text-neutral-200"
                            }`}
                          >
                            {playlist.name}
                          </span>
                          {/* New in its chat from someone else, like a messenger tile. */}
                          <UnreadBadge count={playlist.unread} className="shrink-0" />
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-neutral-600">
                          {collab ? (
                            <Users className="h-2.5 w-2.5 text-accent-alt" />
                          ) : (
                            <Lock className="h-2.5 w-2.5" />
                          )}
                          {/* "tracks": a set can hold record-only tracks, not just clips. */}
                          {playlist.items.length} track
                          {playlist.items.length === 1 ? "" : "s"}
                          {line && <span className="truncate text-accent-alt/80">· {line}</span>}
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
                      {onCollaborate && (
                        <button
                          type="button"
                          onClick={() => onCollaborate(playlist.id)}
                          title={collab ? "Collaborators and join link" : "Collaborate — invite people to build this with you"}
                          className={`rounded p-1.5 hover:bg-ink-800 ${
                            collab ? "text-accent-alt" : "text-neutral-500 hover:text-neutral-200"
                          }`}
                        >
                          <Users className="h-3 w-3" />
                        </button>
                      )}
                      {owner && (<>
                      {/*
                        Share is off until asked for, and the icon shows which
                        state you are in rather than which action is available —
                        "is this one shared?" is the question you actually have
                        when looking down a list of them.
                      */}
                      <button
                        type="button"
                        onClick={() => {
                          const isShared = sharedIds.has(playlist.id);
                          if (
                            isShared &&
                            !window.confirm(
                              `Revoke the link to "${playlist.name}"? Anyone holding it loses access, permanently — a new link will not be the same one.`,
                            )
                          ) {
                            return;
                          }
                          onShare(playlist.id, !isShared);
                        }}
                        title={
                          sharedIds.has(playlist.id)
                            ? "Shared by link — click to revoke"
                            : "Create a read-only share link"
                        }
                        className={`rounded p-1.5 hover:bg-ink-800 ${
                          sharedIds.has(playlist.id)
                            ? "text-accent"
                            : "text-neutral-500 hover:text-neutral-200"
                        }`}
                      >
                        <Link className="h-3 w-3" />
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
                      </>)}
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
        Playlists are private to your account. Amber ones are shared with the
        collaborators you let in — nobody else can see them, and your
        collection is never shared.
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
