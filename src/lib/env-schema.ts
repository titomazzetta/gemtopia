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

/**
 * The message for a key that is not there at all — Zod 4's `error` map in
 * place of Zod 3's `required_error`. Anything else (a wrong type) keeps Zod's
 * own wording, which names the type it expected.
 */
const absent = (message: string) => (issue: { input?: unknown }) =>
  issue.input === undefined ? message : undefined;

export const envSchema = z.object({
  /** Discogs application consumer key (public half of the app credential). */
  DISCOGS_CONSUMER_KEY: z
    .string({ error: absent("DISCOGS_CONSUMER_KEY is missing") })
    .min(8, "DISCOGS_CONSUMER_KEY looks truncated"),

  /** Discogs application consumer secret. Never leaves the server. */
  DISCOGS_CONSUMER_SECRET: z
    .string({ error: absent("DISCOGS_CONSUMER_SECRET is missing") })
    .min(8, "DISCOGS_CONSUMER_SECRET looks truncated"),

  /**
   * 32 bytes of base64url randomness used as the AES-256-GCM key that seals
   * session cookies. Generate with `npm run keygen`.
   */
  SESSION_SECRET: z
    .string({ error: absent("SESSION_SECRET is missing — run `npm run keygen`") })
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
   * Master key for chat encryption at rest (lib/envelope.ts): 32 bytes,
   * base64url. It wraps each shared playlist's own key, and it lives only
   * here — never in the database or its backups — so a copy of the database
   * holds nothing that decrypts. Generate with `npm run keygen`.
   *
   * Optional so a deployment without it still serves everything else; chat
   * refuses to post (and shows sealed messages as unreadable) until it is
   * set, rather than falling back to storing plaintext.
   */
  CHAT_MASTER_KEY: z
    .string()
    .refine(isKey32, { message: "CHAT_MASTER_KEY must be 32 bytes, base64url encoded (43 characters)" })
    .optional(),

  /**
   * Retired master keys, comma separated, kept only until every playlist key
   * they wrapped has been re-wrapped under the current one (admin panel →
   * Encryption → Re-wrap). Then remove them.
   */
  CHAT_MASTER_KEY_PREVIOUS: z
    .string()
    .refine((v) => v.split(",").map((k) => k.trim()).filter(Boolean).every(isKey32), {
      message: "CHAT_MASTER_KEY_PREVIOUS must be 32-byte base64url keys separated by commas",
    })
    .optional(),

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
    .string({ error: absent("APP_ORIGIN is missing") })
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
    .string({ error: absent("DATABASE_URL is missing") })
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
   * Model that reads a photographed sleeve (lib/llm.ts readSleeve). A small
   * one: the job is transcription — artist, title, label, catalogue number,
   * barcode — and the matching is done here, not by the model.
   */
  SLEEVE_READER_MODEL: z.string().min(1).default("claude-haiku-5-5"),

  /**
   * Where the Anthropic API is. Only ever changed to point the test suite at
   * a stub on localhost; production leaves it alone. Must be an origin.
   */
  ANTHROPIC_BASE_URL: z
    .string()
    .default("https://api.anthropic.com")
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return (u.protocol === "https:" || u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname === "/" && !u.search;
        } catch {
          return false;
        }
      },
      { message: "ANTHROPIC_BASE_URL must be an https origin (or a localhost one for tests)" },
    ),

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

  /**
   * Invite-only sign-up. When on, a Discogs account Gemtopia has never seen
   * needs a one-time invite code to get in; everyone who already has a row in
   * `users` carries on as before. Off by default so the migration that adds
   * the invite table can run before anything depends on it.
   *
   * Only the literal strings "true" and "false" are accepted. `z.coerce.boolean`
   * would read "false" as true (it is a non-empty string), which is exactly the
   * wrong way round for a security switch.
   */
  INVITE_ONLY: z
    .enum(["true", "false"], { error: 'INVITE_ONLY must be "true" or "false"' })
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Comma-separated Discogs usernames who can make invite codes and manage
   * members. Admins are always let in. Case-insensitive, like Discogs itself.
   */
  ADMIN_USERNAMES: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    )
    .refine((names) => names.every((name) => /^[a-z0-9._-]{1,64}$/.test(name)), {
      message: "ADMIN_USERNAMES must be Discogs usernames separated by commas",
    }),
}).refine((env) => !env.INVITE_ONLY || env.ADMIN_USERNAMES.length > 0, {
  // Invite-only with nobody able to make codes is a locked door with no key:
  // existing members get in, and nobody new ever can.
  message: "INVITE_ONLY is on but ADMIN_USERNAMES is empty, so nobody could make an invite code",
  path: ["ADMIN_USERNAMES"],
}).refine((env) => !env.CHAT_MASTER_KEY || !sameKey(env.CHAT_MASTER_KEY, env.SESSION_SECRET), {
  // One key, one job. Reusing the session key would mean rotating sessions
  // (the "log everyone out" lever) also locks every chat, and a leak of one
  // would be a leak of both.
  message: "CHAT_MASTER_KEY must be a different key from SESSION_SECRET",
  path: ["CHAT_MASTER_KEY"],
}).refine(
  (env) =>
    !env.CHAT_MASTER_KEY_PREVIOUS ||
    env.CHAT_MASTER_KEY_PREVIOUS.split(",").every(
      (k) => !k.trim() || (!sameKey(k, env.SESSION_SECRET) && (!env.CHAT_MASTER_KEY || !sameKey(k, env.CHAT_MASTER_KEY))),
    ),
  {
    message: "CHAT_MASTER_KEY_PREVIOUS must not repeat the current key or SESSION_SECRET",
    path: ["CHAT_MASTER_KEY_PREVIOUS"],
  },
);

/** 32 bytes of base64url, the shape of every symmetric key here. */
function isKey32(value: string): boolean {
  const v = value.trim();
  return /^[A-Za-z0-9_-]{43}$/.test(v) && Buffer.from(v, "base64url").length === 32;
}

function sameKey(a: string, b: string): boolean {
  return Buffer.from(a.trim(), "base64url").equals(Buffer.from(b.trim(), "base64url"));
}

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
        `Run \`npm run keygen\` for SESSION_SECRET and CHAT_MASTER_KEY.\n` +
        `A blank line like \`ANTHROPIC_API_KEY=\` counts as absent, not invalid.`,
    );
  }

  return Object.freeze(parsed.data);
}
