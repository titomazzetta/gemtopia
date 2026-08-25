import "server-only";
import { z } from "zod";

/**
 * Fail-fast environment validation.
 *
 * Every secret the app needs is declared here and nowhere else. If a value is
 * missing or malformed the process throws at first import rather than failing
 * halfway through an OAuth handshake with a confusing error.
 *
 * None of these names are prefixed `NEXT_PUBLIC_`, so Next.js will refuse to
 * inline any of them into the client bundle.
 */
const schema = z.object({
  /** Discogs application consumer key (public half of the app credential). */
  DISCOGS_CONSUMER_KEY: z.string().min(8, "DISCOGS_CONSUMER_KEY is missing"),

  /** Discogs application consumer secret. Never leaves the server. */
  DISCOGS_CONSUMER_SECRET: z
    .string()
    .min(8, "DISCOGS_CONSUMER_SECRET is missing"),

  /**
   * 32 bytes of base64url randomness used as the AES-256-GCM key that seals
   * session cookies. Generate with `npm run keygen`.
   */
  SESSION_SECRET: z
    .string()
    .min(43, "SESSION_SECRET must be 32 bytes, base64url encoded")
    .refine(
      (v) => {
        try {
          return Buffer.from(v, "base64url").length === 32;
        } catch {
          return false;
        }
      },
      { message: "SESSION_SECRET must decode to exactly 32 bytes" },
    ),

  /**
   * Canonical public origin, e.g. https://crateshuffle.vercel.app
   * Used to build the OAuth callback URL and to reject host-header spoofing.
   */
  APP_ORIGIN: z.string().url("APP_ORIGIN must be an absolute URL"),

  /** Contact string embedded in the Discogs User-Agent, per their API rules. */
  DISCOGS_CONTACT: z.string().min(3).default("+https://github.com/"),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\n` +
      `Copy .env.example to .env.local and fill it in. Run \`npm run keygen\` for SESSION_SECRET.`,
  );
}

export const env = Object.freeze(parsed.data);

export const APP_VERSION = "1.0.0";

/** RFC 1945 compliant User-Agent. Discogs rejects generic agents outright. */
export const USER_AGENT = `CrateShuffle/${APP_VERSION} ${env.DISCOGS_CONTACT}`;

/** Absolute OAuth callback URL registered with Discogs. */
export const CALLBACK_URL = new URL(
  "/api/auth/callback",
  env.APP_ORIGIN,
).toString();
