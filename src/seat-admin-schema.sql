-- V64: apply only after reviewing and backing up the D1 database.
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
CREATE TABLE IF NOT EXISTS seat_admin_guard (
 id INTEGER PRIMARY KEY CHECK(id=1),
 valid INTEGER NOT NULL CHECK(valid=1)
);
