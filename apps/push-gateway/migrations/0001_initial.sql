CREATE TABLE delivery_records (
  fingerprint TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'delivered', 'rejected')),
  lease_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  reason_category TEXT
) WITHOUT ROWID;

CREATE INDEX delivery_records_expiry_idx ON delivery_records (expires_at);

CREATE TABLE daily_budgets (
  utc_date TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts >= 0)
) WITHOUT ROWID;
