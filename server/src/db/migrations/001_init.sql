-- 001_init.sql
-- Core schema for the chat application.
-- Designed for PostgreSQL 13+. gen_random_uuid() has been built into
-- PostgreSQL core since version 13, so no extension (e.g. pgcrypto) is
-- required to generate UUID primary keys.

-- ========== USERS ==========
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    avatar_url      TEXT,
    -- Public key used by other clients to wrap per-group AES keys for this user (E2E encryption).
    public_key      TEXT,
    is_online       BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ========== GROUPS (CONVERSATIONS) ==========
-- A "group" represents any conversation: a 1:1 DM or a multi-user group chat.
CREATE TABLE IF NOT EXISTS groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    is_direct       BOOLEAN NOT NULL DEFAULT FALSE, -- true for 1:1 DMs
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========== GROUP MEMBERS ==========
CREATE TABLE IF NOT EXISTS group_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
    -- The per-group AES-256 symmetric key, RSA-wrapped with this user's public key.
    -- Stored as base64; only this user's private key can unwrap it (server cannot read it).
    wrapped_group_key TEXT,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_message_id UUID,
    UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);

-- ========== INVITE LINKS ==========
CREATE TABLE IF NOT EXISTS invite_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    token           VARCHAR(64) UNIQUE NOT NULL,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    max_uses        INTEGER, -- NULL = unlimited
    uses_count      INTEGER NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ, -- NULL = never expires
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_links_token ON invite_links (token);

-- ========== MESSAGES ==========
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Thread support: a message replying within a thread references its parent.
    parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    thread_root_id  UUID REFERENCES messages(id) ON DELETE SET NULL, -- top of the thread, for fast lookups
    -- E2E encrypted payload. The server never sees plaintext.
    ciphertext      TEXT NOT NULL,
    iv              VARCHAR(64) NOT NULL,      -- AES-GCM initialization vector (base64)
    auth_tag        VARCHAR(64),               -- included for algorithms that separate the tag (kept for portability)
    message_type    VARCHAR(20) NOT NULL DEFAULT 'text', -- 'text' | 'file' | 'system'
    -- Searchable metadata only (NOT message content): server-side search works over this,
    -- true full-text search of content happens client-side after decryption.
    client_search_token TEXT,
    reply_count     INTEGER NOT NULL DEFAULT 0,
    edited          BOOLEAN NOT NULL DEFAULT FALSE,
    deleted         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages (group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (parent_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_root ON messages (thread_root_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);

-- ========== MESSAGE ATTACHMENTS (FILE SHARING) ==========
CREATE TABLE IF NOT EXISTS attachments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name_cipher TEXT NOT NULL,               -- encrypted filename (base64 ciphertext)
    file_name_iv    VARCHAR(64) NOT NULL,         -- IV used to encrypt the filename
    storage_path    TEXT NOT NULL,                -- path on disk to ciphertext blob
    mime_type       VARCHAR(150) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT NOT NULL,
    iv              VARCHAR(64) NOT NULL,         -- IV used to encrypt the file contents
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);

-- ========== OFFLINE MESSAGE QUEUE ==========
-- Tracks delivery state per recipient so messages sent while a user is offline
-- are queued and flushed the moment they reconnect.
CREATE TABLE IF NOT EXISTS message_delivery_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered       BOOLEAN NOT NULL DEFAULT FALSE,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_recipient_pending
    ON message_delivery_queue (recipient_id, delivered);

-- ========== READ RECEIPTS ==========
CREATE TABLE IF NOT EXISTS read_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON read_receipts (message_id);
CREATE INDEX IF NOT EXISTS idx_read_receipts_user ON read_receipts (user_id);

-- ========== REFRESH TOKENS (for JWT auth) ==========
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ========== TRIGGERS: auto-update updated_at ==========
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_users ON users;
CREATE TRIGGER set_updated_at_users
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_groups ON groups;
CREATE TRIGGER set_updated_at_groups
    BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_messages ON messages;
CREATE TRIGGER set_updated_at_messages
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
