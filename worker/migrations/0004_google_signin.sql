-- Google is the only way to sign in. Accounts are matched by Google's stable `sub` once linked
-- (by verified email on the first Google sign-in). New people wait for an admin's approval.
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN approval TEXT NOT NULL DEFAULT 'approved'
  CHECK (approval IN ('approved', 'pending', 'declined'));
CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub);
CREATE INDEX idx_users_approval ON users(approval);

-- One row per "Continue with Google" click. id = SHA-256 of `state`; browser_hash = SHA-256 of the HttpOnly
-- cookie that binds the flow to this browser; nonce_hash = SHA-256 of the ID-token nonce. The PKCE verifier and
-- the nonce are derived from the cookie secret, so nothing here can finish a sign-in on its own. Single use, 10 minutes.
CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/' CHECK (return_to IN ('/', '/account/two-step')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
