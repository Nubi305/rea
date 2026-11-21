CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  holder TEXT NOT NULL,
  iban TEXT NOT NULL UNIQUE,
  opened_on TEXT NOT NULL
);
CREATE TABLE transfers (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  amount_cents INTEGER NOT NULL,
  memo TEXT,
  booked_on TEXT NOT NULL
);
CREATE TABLE settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX transfers_by_account ON transfers (account_id, booked_on);
CREATE VIEW account_balances AS
  SELECT account_id, SUM(amount_cents) AS balance_cents FROM transfers GROUP BY account_id;
INSERT INTO accounts (id, holder, iban, opened_on) VALUES
  (1, 'Ines Marlow', 'NL02TEST0000000001', '2026-01-04'),
  (2, 'Bao Tran', 'NL02TEST0000000002', '2026-01-09'),
  (3, 'Odile Ferrant', 'NL02TEST0000000003', '2026-02-11'),
  (4, 'Kofi Lindqvist', 'NL02TEST0000000004', '2026-03-02');
INSERT INTO settings (name, value) VALUES
  ('schema_version', '12'),
  ('ledger_currency', 'EUR'),
  ('sync_endpoint', 'https://sync.ledger.example.test/v3/push'),
  ('last_sync', '2026-04-30T21:15:00Z');
WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 37)
INSERT INTO transfers (id, account_id, amount_cents, memo, booked_on)
SELECT i, 1 + (i % 4), (i * 137) % 9000 - 2500, 'transfer ' || i, '2026-04-' || printf('%02d', 1 + (i % 28)) FROM n;
