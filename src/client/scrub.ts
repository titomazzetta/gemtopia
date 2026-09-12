/**
 * Scrubber position maths.
 *
 * Kept separate from the components for two reasons. The desktop sidebar and
 * the mobile bar both need it and had no shared home, and the rounding is easy
 * to get subtly wrong in a way that shows up as a thumb that will not reach
 * either end of the track.
 *
 * Position is expressed in thousandths rather than seconds. A range whose max
 * is the track length gives one step per second, which on a six-minute rip is
 * too coarse to land on a drop.
 */

export const SCRUB_STEPS = 1000;

/** Where the thumb sits, 0–1000. Zero whenever the duration is unknown. */
export function positionOf(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(currentTime) || currentTime <= 0) return 0;
  const ratio = currentTime / duration;
  return Math.min(SCRUB_STEPS, Math.max(0, Math.round(ratio * SCRUB_STEPS)));
}

/** What a thumb position means in seconds. Clamped into the track. */
export function secondsOf(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(position)) return 0;
  const clamped = Math.min(SCRUB_STEPS, Math.max(0, position));
  return (clamped / SCRUB_STEPS) * duration;
}
