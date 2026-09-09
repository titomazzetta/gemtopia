import "server-only";
import { parseEnv } from "./env-schema";

/**
 * Fail-fast environment validation.
 *
 * Every secret the app needs is declared in `env-schema.ts` and nowhere else.
 * If a value is missing or malformed the process throws at first import rather
 * than failing halfway through an OAuth handshake with a confusing error.
 *
 * None of these names are prefixed `NEXT_PUBLIC_`, so Next.js will refuse to
 * inline any of them into the client bundle. The schema lives in its own
 * module so it can be tested without `server-only`; this file is the part that
 * actually reads the process environment.
 */
export const env = parseEnv(process.env);

export const APP_VERSION = "1.0.0";

/** RFC 1945 compliant User-Agent. Discogs rejects generic agents outright. */
export const USER_AGENT = `Gemtopia/${APP_VERSION} ${env.DISCOGS_CONTACT}`;

/** Absolute OAuth callback URL registered with Discogs. */
export const CALLBACK_URL = new URL(
  "/api/auth/callback",
  env.APP_ORIGIN,
).toString();

/** Whether the optional Claude ranking layer is available this deployment. */
export const LLM_ENABLED = Boolean(env.ANTHROPIC_API_KEY);
