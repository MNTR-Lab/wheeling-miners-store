-- Apply to TEST D1 first. Do not apply to production until launch approval.
-- One physical-ticket handoff per paid Shopify order. Duplicate inserts fail closed.
CREATE TABLE IF NOT EXISTS seat_ticket_issuance (
 shopify_order_id TEXT PRIMARY KEY,
 issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 issued_by TEXT NOT NULL,
 seat_count INTEGER NOT NULL CHECK(seat_count BETWEEN 1 AND 8)
);
CREATE TABLE IF NOT EXISTS seat_ticket_issuance_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 shopify_order_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='ISSUED'),
 operator TEXT NOT NULL,
 seat_count INTEGER NOT NULL CHECK(seat_count BETWEEN 1 AND 8),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
