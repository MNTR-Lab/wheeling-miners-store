-- Wheeling Miners TEST database only. Do not apply to production.
-- Expiration timestamps use INTEGER epoch milliseconds.
CREATE TABLE IF NOT EXISTS seats (
 sku TEXT PRIMARY KEY,
 section TEXT NOT NULL,
 row_label TEXT NOT NULL,
 seat_number INTEGER NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents > 0),
 status TEXT NOT NULL DEFAULT 'UNRELEASED' CHECK(status IN ('UNRELEASED','AVAILABLE','HELD','SOLD','BLOCKED')),
 hold_id TEXT,
 hold_expires_at INTEGER,
 shopify_order_id TEXT,
 shopify_variant_id TEXT UNIQUE,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reservations (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('HELD','CHECKOUT_PENDING','CONFIRMED','EXPIRED','CANCELLED')),
 created_at INTEGER NOT NULL,
 checkout_nonce TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 shopify_order_id TEXT
);
CREATE TABLE IF NOT EXISTS reservation_seats (
 reservation_id TEXT NOT NULL REFERENCES reservations(id),
 seat_sku TEXT NOT NULL REFERENCES seats(sku),
 shopify_variant_id TEXT NOT NULL,
 PRIMARY KEY(reservation_id,seat_sku)
);
CREATE TABLE IF NOT EXISTS seat_admin_guard (
 id INTEGER PRIMARY KEY CHECK(id=1),
 valid INTEGER NOT NULL CHECK(valid=1)
);
CREATE TABLE IF NOT EXISTS seat_admin_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 seat_sku TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('BLOCK','UNBLOCK')),
 previous_status TEXT NOT NULL,
 new_status TEXT NOT NULL CHECK(new_status IN ('BLOCKED','UNRELEASED')),
 operator TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
