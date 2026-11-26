-- Two-step sign-in (TOTP). The secret is AES-GCM encrypted with the MFA_KEY Worker secret; never stored in clear.
-- totp_secret_enc set + totp_enabled_at NULL = setup started, not confirmed yet.
ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
-- The last accepted 30-second time-step, so a code cannot be used twice.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;

-- One-time backup codes, stored only as SHA-256 hashes.
CREATE TABLE mfa_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_mfa_backup_codes_user_hash ON mfa_backup_codes(user_id, code_hash);

-- Password accepted, code still owed. id is the SHA-256 of the mfaToken given to the browser.
CREATE TABLE mfa_pending (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mfa_pending_user ON mfa_pending(user_id);
CREATE INDEX idx_mfa_pending_expires ON mfa_pending(expires_at);
