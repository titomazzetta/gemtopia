import "server-only";
import { env } from "./env";
import { masterKeyRing, type MasterKeyRing } from "./envelope";

/**
 * The chat master keys for this deployment, parsed once.
 *
 * env-schema.ts has already checked their shape and that none of them is
 * SESSION_SECRET; this builds the ring envelope.ts works with. A deployment
 * without CHAT_MASTER_KEY gets `null`, and every caller treats that as "chat
 * is unavailable" — never as "store it in plaintext instead".
 */
let cached: MasterKeyRing | null | undefined;

export function chatKeyRing(): MasterKeyRing | null {
  if (cached === undefined) {
    cached = env.CHAT_MASTER_KEY
      ? masterKeyRing(env.CHAT_MASTER_KEY, env.CHAT_MASTER_KEY_PREVIOUS)
      : null;
    if (!cached) {
      console.error("[chat] CHAT_MASTER_KEY is not set: chat posting is disabled until it is");
    }
  }
  return cached;
}

/** Thrown where a key is needed and the deployment has none configured. */
export class ChatKeyMissingError extends Error {
  constructor() {
    super("chat encryption key is not configured");
    this.name = "ChatKeyMissingError";
  }
}

export function requireChatKeyRing(): MasterKeyRing {
  const ring = chatKeyRing();
  if (!ring) throw new ChatKeyMissingError();
  return ring;
}
