"use client";

import type { InsightsResponse } from "@/client/api";
import type { Weighted } from "@/lib/types";
import { Refresh, Sparkle } from "./Icons";

/**
 * Playlist dissection.
 *
 * The layout deliberately puts the deterministic breakdown first and the
 * written characterisation second, because the breakdown is the part that is
 * verifiably true — it is a count of the user's own metadata. Each
 * recommendation shows the graph path that produced it ("Labelmate on Rush
 * Hour") whether or not the model ran, so nothing is ever taken on trust.
 */

function Bars({ title, items }: { title: string; items: Weighted[] }) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.count));

  return (
    <div>
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h4>
      <ul className="space-y-1">
        {items.slice(0, 6).map((item) => (
          <li key={item.name} className="relative">
            <div
              className="absolute inset-y-0 left-0 rounded-sm bg-accent/10"
              style={{ width: `${(item.count / max) * 100}%` }}
              aria-hidden="true"
            />
            <div className="relative flex justify-between px-1.5 py-0.5 text-[11px]">
              <span className="truncate text-neutral-300">{item.name}</span>
              <span className="ml-2 shrink-0 font-mono text-neutral-600">
                {item.count}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InsightsPanel({
  playlistName,
  data,
  loading,
  error,
  onAnalyse,
  onRefresh,
}: {
  playlistName: string | null;
  data: InsightsResponse | null;
  loading: boolean;
  error: string | null;
  onAnalyse: () => void;
  onRefresh: () => void;
}) {
  if (!playlistName) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-neutral-600">
        Select a playlist to dissect it and get recommendations.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-ink-800 bg-ink-900/95 px-4 py-2.5 backdrop-blur">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-200">
          {playlistName}
        </h3>
        {data ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Re-run the analysis"
            className="rounded border border-ink-700 p-1.5 text-neutral-500 hover:text-neutral-200 disabled:opacity-40"
          >
            <Refresh className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onAnalyse}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-ink-950 disabled:opacity-40"
          >
            <Sparkle className="h-3 w-3" />
            {loading ? "Digging…" : "Analyse"}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="m-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {loading && !data && (
        <div className="space-y-2 p-4">
          <p className="text-[11px] text-neutral-500">
            Walking the graph — artists, their other releases, the labels they
            appear on, their labelmates. This takes a few seconds because it is
            real Discogs data, not a guess.
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-5 p-4">
          {/* Written characterisation — only when the model ran. */}
          {data.summary && (
            <section>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Sparkle className="h-3 w-3 text-accent" />
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  What this playlist is
                </h4>
              </div>
              <p className="text-xs leading-relaxed text-neutral-300">
                {data.summary}
              </p>
            </section>
          )}

          {!data.usedLlm && data.llmSkipped === "no_key" && (
            <p className="rounded border border-ink-700 bg-ink-850 px-2.5 py-2 text-[10px] leading-relaxed text-neutral-500">
              Written analysis is off — no <code>ANTHROPIC_API_KEY</code> is set
              on this deployment. Recommendations below are the deterministic
              graph results, which is the part that finds the records anyway.
            </p>
          )}

          {!data.usedLlm && data.llmSkipped === "budget" && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-300">
              Daily AI budget reached. Graph recommendations still shown.
            </p>
          )}

          {/* Deterministic DNA */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Playlist DNA
            </h4>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border border-ink-800 bg-ink-850 px-2 py-1.5">
                <div className="text-neutral-600">Tracks</div>
                <div className="font-mono text-neutral-200">
                  {data.profile.trackCount}
                </div>
              </div>
              <div className="rounded border border-ink-800 bg-ink-850 px-2 py-1.5">
                <div className="text-neutral-600">Era</div>
                <div className="font-mono text-neutral-200">
                  {data.profile.yearRange
                    ? `${data.profile.yearRange.from}–${data.profile.yearRange.to}`
                    : "—"}
                </div>
              </div>
              <div className="col-span-2 rounded border border-ink-800 bg-ink-850 px-2 py-1.5">
                <div className="text-neutral-600">Tempo</div>
                <div className="font-mono text-neutral-200">
                  {data.profile.bpm.median !== null
                    ? `${data.profile.bpm.median} BPM median · ${data.profile.bpm.min}–${data.profile.bpm.max} · ${data.profile.bpm.known}/${data.profile.trackCount} catalogued`
                    : "no BPM catalogued yet"}
                </div>
              </div>
            </div>

            <Bars title="Styles" items={data.profile.styles} />
            <Bars title="Labels" items={data.profile.labels} />
            <Bars title="Artists" items={data.profile.artists} />
            {data.profile.adjacentLabels.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Labels your artists also release on
                </h4>
                <div className="flex flex-wrap gap-1">
                  {data.profile.adjacentLabels.slice(0, 8).map((label) => (
                    <span
                      key={label.name}
                      className="rounded-full border border-ink-700 bg-ink-850 px-2 py-0.5 text-[10px] text-neutral-400"
                    >
                      {label.name}
                      <span className="ml-1 text-neutral-600">{label.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Recommendations */}
          <section>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Dig next · {data.recommendations.length} records
            </h4>

            <ul className="space-y-2">
              {data.recommendations.map((rec) => (
                <li
                  key={rec.releaseId}
                  className="rounded border border-ink-800 bg-ink-850 p-2"
                >
                  <div className="flex gap-2">
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-ink-800">
                      {rec.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={rec.thumb}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </span>

                    <div className="min-w-0 flex-1">
                      <a
                        href={rec.discogsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[12px] font-medium text-neutral-100 hover:text-accent"
                      >
                        {rec.artist} — {rec.title}
                      </a>
                      <div className="truncate text-[10px] text-neutral-600">
                        {rec.year ?? "—"}
                        {rec.labels[0] ? ` · ${rec.labels[0]}` : ""}
                        {rec.inWantlist ? " · on your wantlist" : ""}
                      </div>
                    </div>
                  </div>

                  {rec.reason && (
                    <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">
                      {rec.reason}
                    </p>
                  )}

                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rec.signals.slice(0, 3).map((signal) => (
                      <span
                        key={signal}
                        className="rounded bg-ink-800 px-1.5 py-0.5 text-[9px] text-neutral-500"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            {data.recommendations.length === 0 && (
              <p className="text-[11px] text-neutral-600">
                The graph found nothing you do not already own. That is a good
                sign about your digging.
              </p>
            )}
          </section>

          <p className="border-t border-ink-800 pt-3 text-[10px] leading-relaxed text-neutral-600">
            Every record above is a real Discogs release reached by walking
            artist and label relationships from this playlist.
            {data.usedLlm
              ? " Claude ordered them and wrote the reasons; it could not add records the graph did not find."
              : ""}
            {data.cachedAt
              ? ` Cached ${new Date(data.cachedAt).toLocaleString()}.`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}
