-- TEST database only until separately approved for production.
CREATE TABLE IF NOT EXISTS seat_receipt_qr (
 shopify_order_id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_seat_receipt_qr_token_hash ON seat_receipt_qr(token_hash);
