"use client";

import { useState, type KeyboardEvent } from "react";
import {
  normaliseTag,
  sortTags,
  suggestTags,
  TAG_MAX_CHARS,
  TAGS_PER_TRACK,
} from "@/lib/tags";

/**
 * One track's tags: chips you can remove, a field to type new ones, and your
 * most-used tags offered one tap away.
 *
 * Enter or a comma adds what you've typed (a pasted "deep, opening" adds
 * both), and so does moving on. Tags are lower case and sorted; "#deep" and
 * "Deep" are both deep. Every change hands the whole new set up — the caller
 * saves it (useTrackTags), and this shows whatever it's given.
 *
 * Typing here never reaches the player: the window's key handlers ignore
 * keys aimed at a text field, the record card's included.
 */
export function TagEditor({
  tags,
  ranked,
  onChange,
  onPick,
  label,
}: {
  tags: readonly string[];
  /** Your tags, most-used first. */
  ranked: ReadonlyArray<readonly [string, number]>;
  onChange: (tags: string[]) => void;
  /** Show every track with this tag. Omitted, the chips aren't buttons. */
  onPick?: (tag: string) => void;
  /** "Your tags for Mirror Ball" — names the group for a screen reader. */
  label: string;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const full = tags.length >= TAGS_PER_TRACK;

  /** Add every complete tag in `parts` in one change; say why if one can't go in. */
  const addAll = (parts: readonly string[]): boolean => {
    const next = [...tags];
    let refused: string | null = null;
    for (const part of parts) {
      const one = normaliseTag(part);
      if (!one.ok) {
        if (one.reason === "too_long") refused = `A tag can be up to ${TAG_MAX_CHARS} characters.`;
        continue;
      }
      if (next.includes(one.tag)) continue;
      if (next.length >= TAGS_PER_TRACK) {
        refused = `A track can have up to ${TAGS_PER_TRACK} tags.`;
        break;
      }
      next.push(one.tag);
    }
    setNote(refused);
    if (next.length !== tags.length) onChange(sortTags(next));
    return refused === null;
  };

  const commitTyped = () => {
    if (text.trim() === "") return;
    if (addAll([text])) setText("");
  };

  const onType = (value: string) => {
    setNote(null);
    if (!value.includes(",")) {
      // Leading spaces never count ("deep, opening" types one after the comma).
      setText(value.trimStart());
      return;
    }
    // Typed or pasted with commas: everything before the last comma is done.
    const parts = value.split(",");
    const rest = parts.pop() ?? "";
    addAll(parts);
    setText(rest.trimStart());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTyped();
    } else if (event.key === "Escape" && text !== "") {
      // First Esc clears what you were typing; the next one closes things.
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setText("");
      setNote(null);
    }
  };

  const suggestions = full ? [] : suggestTags(ranked, tags, text, 6);

  return (
    <div role="group" aria-label={label}>
      {/*
        The box takes the field's focus ring, so the ring goes round the
        chips and the field together rather than doubling up inside them.
      */}
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-ink-800 bg-ink-900/60 px-1.5 py-1 has-[input:focus-visible]:border-accent/60 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-accent has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-ink-950">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center rounded-full border border-accent/40 bg-accent/10 text-[11px] text-accent"
          >
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(tag)}
                title={`Show every track tagged ${tag}`}
                aria-label={`Show tracks tagged ${tag}`}
                className="min-w-0 truncate py-0.5 pl-2 pr-0.5 hover:underline"
              >
                <span aria-hidden="true" className="text-accent/60">#</span>
                {tag}
              </button>
            ) : (
              <span className="min-w-0 truncate py-0.5 pl-2 pr-0.5">
                <span aria-hidden="true" className="text-accent/60">#</span>
                {tag}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setNote(null);
                onChange(tags.filter((t) => t !== tag));
              }}
              aria-label={`Remove tag ${tag}`}
              title="Remove"
              className="px-1.5 py-0.5 text-accent/70 hover:text-accent"
            >
              ×
            </button>
          </span>
        ))}
        {!full && (
          <input
            type="text"
            value={text}
            onChange={(event) => onType(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commitTyped}
            placeholder={tags.length > 0 ? "add a tag" : "tag it: deep, opening…"}
            aria-label={tags.length > 0 ? "Add a tag" : "Add your first tag"}
            enterKeyHint="done"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={TAG_MAX_CHARS * 2}
            className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-[11px] text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              // Keep the field's focus: a tap here shouldn't commit what's
              // half-typed as a tag of its own first.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (addAll([tag])) setText("");
              }}
              aria-label={count === null ? `Add tag ${tag}` : `Add tag ${tag}, on ${count} already`}
              className="rounded-full border border-ink-700 px-2 py-0.5 text-[10px] text-neutral-400 hover:border-accent/50 hover:text-accent"
            >
              + {tag}
              {count !== null && <span className="ml-1 text-neutral-600">{count}</span>}
            </button>
          ))}
        </div>
      )}

      {note && (
        <p role="status" className="mt-1 text-[10px] text-amber-300">
          {note}
        </p>
      )}
    </div>
  );
}
