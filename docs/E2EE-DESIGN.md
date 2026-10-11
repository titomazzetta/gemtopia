# End-to-end encrypted chat: the design, and why it isn't built yet

Gemtopia's chat is encrypted **in transit** (HTTPS, HSTS; TLS with a verified
certificate and channel binding to the database) and **at rest** (AES-256-GCM
under a per-playlist key that is itself wrapped by a master key the database
never sees). See [THREAT_MODEL.md §5](../THREAT_MODEL.md#chat-encryption-at-rest).

That protects messages from everyone who touches the *data* — a database dump,
a leaked backup, someone with database access — but not from whoever controls
the *running server*, because the server decrypts to show messages to the
people on the playlist. End-to-end encryption (E2EE) closes that last gap:
only the members' devices can read, and the server stores and relays
ciphertext it cannot open.

This document is the design for that step, written down before building it,
because the hard part of E2EE in a web app is not the cryptography.

---

## 1. What changes in the threat model

| Adversary | At rest (today) | End-to-end (this design) |
|---|---|---|
| Database dump / backup leak | Ciphertext only | Ciphertext only |
| Someone with database access | Ciphertext only | Ciphertext only |
| Someone controlling the server or the Vercel account | **Can read** (holds the master key) | Cannot read *stored* messages; can still serve malicious code (§5) |
| A removed member | Loses access immediately (server-enforced) | Loses access to *new* messages after the key rotates (§3.4); keeps what they already had on their device |
| The person sent the join link | Can read once they join | Same — the link is the invitation, and carries the key (§3.2) |

The honest headline: E2EE moves trust from "the server's database and secrets"
to "the code the server sends to the browser". That trade is worth it only
with the mitigations in §5.

---

## 2. Building blocks (all WebCrypto, no third-party crypto library)

- **Device identity key**: an ECDH P-256 key pair per browser, generated with
  `crypto.subtle.generateKey(..., extractable: false)` and kept in IndexedDB.
  The private key is non-extractable: script running on the page can *use* it
  but can never read its bytes, so an XSS can't copy it off the device.
- **Playlist group key**: a random AES-256-GCM key per playlist *epoch*
  (§3.4). Messages are sealed exactly as they are today — same format, same
  AAD (playlist id, message id, kind) — just in the browser instead of on the
  server.
- **Key wrapping**: to give a device the group key, the sender derives a
  shared secret with that device's public key (ECDH), runs it through HKDF
  with the playlist id and epoch as context, and wraps the group key with
  AES-KW. The server stores and forwards the wrapped blobs; it can't open them.
- **Fingerprints**: each device public key has a short fingerprint
  (SHA-256, displayed as words or a small grid) that members can compare in
  person — the "safety number" pattern — to rule out the server substituting
  its own key.

---

## 3. Flows

### 3.1 Creating a shared playlist

The owner's device generates the epoch-0 group key and stores it wrapped for
each of the owner's own devices. Nothing readable leaves the device.

### 3.2 Inviting someone

The join link becomes `https://…/join/<token>#k=<group key, base64url>`.
The part after `#` is never sent to the server by any browser — it stays in
the address bar. Whoever opens the link reads the key from the fragment, joins
(the token works exactly as today), and their device wraps the key for itself.

This is the same trust the link already carries: anyone holding it can join,
so anyone holding it may read. It avoids the classic E2EE dead end where a new
member can't read anything until an existing member happens to come online.

### 3.3 A second device (phone + laptop)

The hard problem in every E2EE product. Options, in the order I'd build them:

1. **Device linking by QR code**: the laptop shows a QR code with a one-time
   public key; the phone scans it, and the laptop wraps every playlist key for
   the phone. Same pattern as Signal and WhatsApp desktop linking.
2. **The join link again**: an owner can re-open their own link on a new
   device (the owner can already re-copy it, sealed, today).
3. **A recovery passphrase** (optional): playlist keys wrapped under a key
   derived from a passphrase with a memory-hard KDF (Argon2id via WASM,
   or PBKDF2-SHA256 at ≥ 600k iterations as the WebCrypto-only fallback) and
   stored server-side. Only for people who want history on a brand new device
   with no other device around; the server never sees the passphrase.

### 3.4 Someone leaves or is removed

Rotate: the next message after a membership change starts a new epoch with a
new group key, wrapped for the remaining devices only. The removed person keeps
whatever they had already decrypted — no system can take back what a device
has seen — but can't read anything new. Old epochs' keys stay with the members
who had them, so history still reads.

### 3.5 Activity notes ("komron added Shiva")

Today the server writes these in the same transaction as the edit, so they
can't be forged. Under E2EE the server can't seal them, so they move to the
client: the device making the edit seals the note and sends it with the edit;
the server checks it's a well-formed sealed blob from that device's member and
stores both atomically. The guarantee shifts from "only the server writes
notes" to "only a member's device writes notes, and the server binds it to the
edit that member made" — slightly weaker, and worth saying so.

---

## 4. What the server still does

- Authenticates, authorises (`CAN_EDIT`), rate-limits — unchanged.
- Stores ciphertext, wrapped keys, device public keys, epochs.
- Can see metadata: who posted, when, how long (ciphertext length, though
  padding to fixed buckets would blur it), and which playlists are active.
  E2EE hides content, not the fact of communication.

---

## 5. The web caveat, and what mitigates it

In a native app you install code once and it updates through a store. On the
web, the server sends the code on every visit — so a compromised server can
send code that quietly exfiltrates keys or plaintext. That is the standard,
correct objection to browser E2EE, and it is why this design is honest about it.
Mitigations, from cheapest to strongest:

1. **Strict CSP** (already in place): nonce-gated scripts, `connect-src 'self'`
   — injected *content* can't add a script or ship data to another host.
2. **Non-extractable keys** (§2): even malicious code can't copy the private
   key off the device, only use it while the page is open.
3. **Published, reproducible builds**: the bundle's hashes published per
   release, so anyone can check what the server is serving matches the source.
4. **An installed app shell** (the PWA already exists): with a service worker
   pinning the app's code, updates become explicit events rather than every
   page load, which narrows the window for a targeted malicious build.
5. **A native wrapper or a browser extension** that verifies the bundle
   signature before running it — the approach WhatsApp Web's "Code Verify"
   uses. The strongest option and the most work.

---

## 6. Why it isn't built yet

- **UX cost on exactly the flows this app depends on**: B2B partners joining
  from a link on a phone, reading on the laptop later. Every one of those
  becomes a key-delivery problem (§3.2–3.3).
- **History loss is real**: clear site data without a second device or a
  recovery passphrase and the chat history is gone. Today that can't happen.
- **The content is a DJ's set notes**, not medical records. At-rest encryption
  with keys outside the database, a database that refuses plaintext, and
  tamper detection cover the realistic threats (data leaks) for this data.
- **Effort**: roughly three to four times the at-rest work — device keys,
  epochs, linking UI, recovery, client-side notes, migration — and a much larger
  test surface (multi-device, offline, rotation races).

## 7. Migration path from today

The at-rest format was chosen so this step reuses it: same sealed-blob layout,
same AAD fields, same per-playlist key idea. Migrating a playlist means a
member's device fetching the current (server-unwrapped) key once, wrapping it
for the members' devices, and the server deleting its own wrapped copy — after
which only devices can open that playlist's messages. Playlists can move one
at a time; nothing about the message format changes.
