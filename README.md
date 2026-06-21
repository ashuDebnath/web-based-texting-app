# SecureChat

A full-stack, end-to-end encrypted group chat application built with Node.js/Express, Socket.IO, React, and PostgreSQL.

## Features

- **End-to-end encryption** — messages and files are encrypted/decrypted entirely in the browser using the native Web Crypto API (RSA-OAEP for identity keys, AES-256-GCM for messages/files). The server only ever stores ciphertext and RSA-wrapped symmetric keys; it cannot read your messages.
- **Offline message queueing** — messages sent to offline users are queued server-side and flushed automatically the moment they reconnect.
- **Search across messages** — full-text search runs client-side over your already-decrypted message history (the server cannot search encrypted content).
- **Read receipts** — double-check marks show when a message has been read.
- **Online/offline presence** — live presence indicators via Socket.IO, correctly handling multiple tabs/devices per user.
- **File sharing** — files are encrypted client-side before upload; the server stores opaque ciphertext blobs.
- **Rate limiting** — both HTTP (express-rate-limit) and WebSocket (custom token-bucket) layers.
- **Threaded conversations** — reply in a thread without cluttering the main channel.
- **Shareable invite links** — anyone with a link can join a group conversation (with optional expiry / max-uses).
- **PostgreSQL** — relational schema with proper indexes, transactions, and migrations.

---

## How the encryption works

1. On sign-up, your browser generates an RSA-OAEP keypair. The **private key never leaves your device** (stored in `localStorage`); the **public key** is uploaded so others can encrypt things for you.
2. When you create a group, your browser generates a random AES-256 key for that conversation, then encrypts ("wraps") a copy of it for every member using each member's public key. The server stores only these wrapped copies — it cannot unwrap them.
3. Every message and file is encrypted with the group's AES key before it's sent. The server stores ciphertext + IV only.
4. When you open a conversation, your browser unwraps the group key with your private key (locally) and decrypts messages as they arrive.
5. **Joining via an invite link**: a new member joins without a key at first. If another member is online, their browser automatically re-wraps the group key for the newcomer and delivers it — so the conversation stays end-to-end encrypted even for link-based joins. If no member is online at join time, the newcomer's client will pick up the key automatically the next time someone who has it comes online.
6. **New device / cleared storage**: since the private key only lives on the device that created it, logging in on a new device can't decrypt old history by design (this is standard E2E behavior — there's no master key on the server that could do this safely). The app will prompt you to generate a new keypair, which works for new messages going forward.

## Database schema

- `users` — accounts + public keys
- `groups` / `group_members` — conversations and membership (incl. per-member wrapped group key)
- `invite_links` — shareable join tokens
- `messages` — encrypted message content, supports threading via `parent_message_id` / `thread_root_id`
- `attachments` — encrypted file metadata
- `message_delivery_queue` — offline delivery tracking
- `read_receipts` — per-user read state
