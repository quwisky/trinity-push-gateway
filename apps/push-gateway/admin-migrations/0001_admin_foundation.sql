CREATE TABLE operator_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject),
  CONSTRAINT operator_identities_timestamps_check CHECK (
    created_at >= 0 AND updated_at >= created_at
  ),
  CONSTRAINT operator_identities_values_check CHECK (
    length(issuer) BETWEEN 1 AND 2048
      AND length(subject) BETWEEN 1 AND 512
      AND (display_name IS NULL OR length(display_name) BETWEEN 1 AND 256)
      AND (email IS NULL OR length(email) BETWEEN 3 AND 320)
  )
) WITHOUT ROWID;

CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY,
  session_digest TEXT NOT NULL,
  xsrf_digest TEXT NOT NULL,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  policy_fingerprint TEXT NOT NULL,
  revoked_at INTEGER,
  CONSTRAINT operator_sessions_identity_fk
    FOREIGN KEY (issuer, subject)
    REFERENCES operator_identities (issuer, subject)
    ON DELETE RESTRICT,
  CONSTRAINT operator_sessions_timestamps_check CHECK (
    created_at >= 0
      AND last_seen_at >= created_at
      AND idle_expires_at > created_at
      AND absolute_expires_at > created_at
      AND idle_expires_at <= absolute_expires_at
      AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT operator_sessions_values_check CHECK (
    length(id) BETWEEN 16 AND 128
      AND length(session_digest) >= 1
      AND length(xsrf_digest) >= 1
      AND session_digest <> xsrf_digest
      AND length(policy_fingerprint) >= 1
  )
) WITHOUT ROWID;

CREATE UNIQUE INDEX operator_sessions_session_digest_idx
  ON operator_sessions (session_digest);
CREATE UNIQUE INDEX operator_sessions_xsrf_digest_idx
  ON operator_sessions (xsrf_digest);
CREATE INDEX operator_sessions_identity_idx
  ON operator_sessions (issuer, subject, created_at, id);
CREATE INDEX operator_sessions_last_seen_idx
  ON operator_sessions (last_seen_at, id);
CREATE INDEX operator_sessions_expiry_idx
  ON operator_sessions (idle_expires_at, absolute_expires_at);

CREATE TABLE oidc_login_attempts (
  state_digest TEXT PRIMARY KEY,
  cookie_digest TEXT,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  CONSTRAINT oidc_login_attempts_expiry_check CHECK (expires_at >= 0),
  CONSTRAINT oidc_login_attempts_values_check CHECK (
    length(state_digest) >= 1
      AND (cookie_digest IS NULL OR length(cookie_digest) >= 1)
      AND length(code_verifier) >= 1
      AND length(nonce) >= 1
  )
) WITHOUT ROWID;

CREATE UNIQUE INDEX oidc_login_attempts_cookie_digest_idx
  ON oidc_login_attempts (cookie_digest);
CREATE INDEX oidc_login_attempts_expiry_idx
  ON oidc_login_attempts (expires_at);

CREATE TABLE operator_audit_entries (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  issuer TEXT,
  subject TEXT,
  kind TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT,
  CONSTRAINT operator_audit_entries_identity_fk
    FOREIGN KEY (issuer, subject)
    REFERENCES operator_identities (issuer, subject)
    ON DELETE RESTRICT,
  CONSTRAINT operator_audit_entries_identity_check CHECK (
    (issuer IS NULL AND subject IS NULL)
      OR (issuer IS NOT NULL AND subject IS NOT NULL)
  ),
  CONSTRAINT operator_audit_entries_kind_check CHECK (
    kind IN (
      'login', 'logout', 'session_expired', 'session_revoked',
      'session_cap_eviction', 'policy_rejected', 'session_purge',
      'firebase_validation', 'cleanup', 'backup'
    )
  ),
  CONSTRAINT operator_audit_entries_outcome_check CHECK (
    outcome IN ('succeeded', 'failed', 'started', 'outcome_unknown')
  ),
  CONSTRAINT operator_audit_entries_reason_check CHECK (
    reason IS NULL OR (
      length(reason) BETWEEN 1 AND 64
        AND substr(reason, 1, 1) GLOB '[a-z]'
        AND reason NOT GLOB '*[^a-z0-9_]*'
    )
  ),
  CONSTRAINT operator_audit_entries_values_check CHECK (
    length(id) BETWEEN 16 AND 128 AND occurred_at >= 0
  )
) WITHOUT ROWID;

CREATE INDEX operator_audit_entries_occurred_idx
  ON operator_audit_entries (occurred_at, id);
CREATE INDEX operator_audit_entries_identity_idx
  ON operator_audit_entries (issuer, subject, occurred_at);

CREATE TABLE operation_leases (
  kind TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  cooldown_ends_at INTEGER NOT NULL,
  CONSTRAINT operation_leases_kind_check CHECK (
    kind IN ('firebase_validation', 'cleanup', 'backup')
  ),
  CONSTRAINT operation_leases_timestamps_check CHECK (
    acquired_at >= 0
      AND lease_expires_at > acquired_at
      AND cooldown_ends_at >= lease_expires_at
  ),
  CONSTRAINT operation_leases_values_check CHECK (
    length(lease_id) BETWEEN 16 AND 128
  )
) WITHOUT ROWID;

CREATE UNIQUE INDEX operation_leases_lease_id_idx
  ON operation_leases (lease_id);
CREATE INDEX operation_leases_expiry_idx
  ON operation_leases (lease_expires_at, cooldown_ends_at);
