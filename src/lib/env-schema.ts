import { z } from "zod";

/**
 * The environment contract, kept separate from `env.ts` so it can be tested
 * without pulling in `server-only` and the rest of the app.
 *
 * `env.ts` is the server-only module that runs this against `process.env` once
 * at import and freezes the result. Everything interesting lives here.
 */

/** Anything key/value-shaped: `process.env`, or a literal in a test. */
export type RawEnv = Record<string, string | undefined>;

/**
 * A `.env` file cannot express "absent". A key that is present but blank —
 *
 *     ANTHROPIC_API_KEY=
 *
 * — arrives as the empty string, not `undefined`, so `.optional()` does not
 * apply, `.default()` does not apply, and `z.coerce.number()` turns it into 0.
 * Every optional field in this schema was therefore wrong in the same way: the
 * app refused to start unless you deleted the line entirely, which is not what
 * "optional" means to anyone reading `.env.example`.
 *
 * Blank means absent. Normalising here, once, is what makes `.optional()` and
 * `.default()` behave the way the comments beside them claim.
 */
export function withoutBlanks(raw: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim() === "") continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export const envSchema = z.object({
  /** Discogs application consumer key (public half of the app credential). */
  DISCOGS_CONSUMER_KEY: z
    .string({ required_error: "DISCOGS_CONSUMER_KEY is missing" })
    .min(8, "DISCOGS_CONSUMER_KEY looks truncated"),

  /** Discogs application consumer secret. Never leaves the server. */
  DISCOGS_CONSUMER_SECRET: z
    .string({ required_error: "DISCOGS_CONSUMER_SECRET is missing" })
    .min(8, "DISCOGS_CONSUMER_SECRET looks truncated"),

  /**
   * 32 bytes of base64url randomness used as the AES-256-GCM key that seals
   * session cookies. Generate with `npm run keygen`.
   */
  SESSION_SECRET: z
    .string({ required_error: "SESSION_SECRET is missing — run `npm run keygen`" })
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
   * Canonical public origin, e.g. https://gemtopia.vercel.app
   * Used to build the OAuth callback URL and to reject host-header spoofing.
   */
  /*
   * `.url()` alone is not enough. `new URL("localhost:3000")` succeeds — it
   * reads as scheme `localhost:` with path `3000` — so a plausible typo would
   * validate and then silently build a callback URL Discogs can never match.
   * Require the scheme explicitly.
   */
  APP_ORIGIN: z
    .string({ required_error: "APP_ORIGIN is missing" })
    .url("APP_ORIGIN must be an absolute URL")
    .refine((v) => /^https?:\/\//.test(v), {
      message: "APP_ORIGIN must start with http:// or https://",
    })
    .refine((v) => !v.endsWith("/"), {
      message: "APP_ORIGIN must not have a trailing slash",
    })
    .refine(
      (v) => {
        try {
          return new URL(v).pathname === "/";
        } catch {
          return false;
        }
      },
      { message: "APP_ORIGIN must be an origin only — no path" },
    ),

  /** Contact string embedded in the Discogs User-Agent, per their API rules. */
  DISCOGS_CONTACT: z.string().min(3).default("+https://github.com/"),

  /**
   * Postgres connection string. On Neon use the **pooled** endpoint (the host
   * containing `-pooler`) — serverless functions open and drop connections
   * constantly and would exhaust a direct endpoint.
   */
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is missing" })
    .min(1, "DATABASE_URL is missing")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// connection string",
    }),

  /**
   * Optional. When absent, playlist analysis still works — it falls back to
   * the deterministic Discogs-graph recommender and simply skips the written
   * summary. Nothing in the app hard-depends on an LLM being available.
   */
  ANTHROPIC_API_KEY: z.string().min(10, "ANTHROPIC_API_KEY looks truncated").optional(),

  /** Model used for the ranking pass. Overridable without a code change. */
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-5"),

  /**
   * Per-user ceiling on LLM output tokens per rolling 24h. Stops one user
   * (or one runaway loop) from spending the deployment's whole budget.
   */
  LLM_DAILY_OUTPUT_TOKEN_BUDGET: z.coerce
    .number()
    .int()
    .positive()
    .default(40_000),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and freeze. Throws with every problem listed at once, rather than
 * making you rediscover them one restart at a time.
 */
export function parseEnv(raw: RawEnv): Readonly<Env> {
  const parsed = envSchema.safeParse(withoutBlanks(raw));

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env.local and fill it in. ` +
        `Run \`npm run keygen\` for SESSION_SECRET.\n` +
        `A blank line like \`ANTHROPIC_API_KEY=\` counts as absent, not invalid.`,
    );
  }

  return Object.freeze(parsed.data);
}
