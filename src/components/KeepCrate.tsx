"use client";

import { useEffect, useRef, useState } from "react";
import {
  askToKeep,
  keepQuietly,
  readKeeping,
  type Keeping,
  type StorageManagerLike,
} from "@/client/storagePersistence";

const storage = (): StorageManagerLike | undefined =>
  typeof navigator === "undefined" ? undefined : (navigator.storage as StorageManagerLike | undefined);

/**
 * The account menu's line about the crate on this device: whether the browser
 * has agreed to keep it, and a button to ask when it hasn't.
 *
 * It also does the asking that needs no button (client/storagePersistence.ts):
 * once there is a crate, and only in a browser that answers without putting a
 * prompt in front of anyone. Mounted with the menu, which is in the page
 * whether or not it is open, so that happens on its own.
 *
 * Renders nothing where the browser cannot say either way.
 */
export function KeepCrate({ hasCrate }: { hasCrate: boolean }) {
  const [keeping, setKeeping] = useState<Keeping>("unknown");
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const askedQuietly = useRef(false);

  // What the browser says as the app opens. A yes that has already arrived
  // from the ask below is never overwritten by this older reading.
  useEffect(() => {
    void readKeeping(storage()).then((read) => setKeeping((current) => (current === "kept" ? current : read)));
  }, []);

  // Once there is a crate worth keeping, ask — once a visit, and only quietly.
  useEffect(() => {
    if (!hasCrate || askedQuietly.current) return;
    askedQuietly.current = true;
    void keepQuietly({ storage: storage(), userAgent: navigator.userAgent }).then((result) =>
      setKeeping(result.state),
    );
  }, [hasCrate]);

  if (keeping === "unknown") return null;

  if (keeping === "kept") {
    return (
      <p className="mb-0.5 px-2 py-1.5 text-xs text-neutral-300">
        Crate kept on this device
        <span className="mt-0.5 block text-[10px] leading-snug text-neutral-600">
          This browser has agreed not to clear it
        </span>
      </p>
    );
  }

  const ask = async () => {
    setBusy(true);
    const answer = await askToKeep(storage());
    setBusy(false);
    setKeeping(answer);
    setRefused(answer !== "kept");
  };

  return (
    <button
      type="button"
      onClick={() => void ask()}
      disabled={busy}
      className="mb-0.5 w-full rounded-sm px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-ink-800 disabled:opacity-60"
    >
      Keep my crate on this device
      <span className="mt-0.5 block text-[10px] leading-snug text-neutral-600" aria-live="polite">
        {refused
          ? "Not yet. A browser goes by how you use a site; having Gemtopia on your Home Screen counts."
          : "Ask this browser not to clear it"}
      </span>
    </button>
  );
}
