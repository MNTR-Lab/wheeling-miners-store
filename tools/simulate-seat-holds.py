#!/usr/bin/env python3
"""V58: local-only SQLite rehearsal of atomic, multi-seat reservation holds.
Never connects to Cloudflare D1 or Shopify and never enables sales.
"""
import json
import sqlite3
import sys
import time
import uuid

SCHEMA = '''
CREATE TABLE seats(sku TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('UNRELEASED','AVAILABLE','HELD','SOLD','BLOCKED')),shopify_variant_id TEXT,hold_id TEXT,hold_expires_at INTEGER);
CREATE TABLE reservations(id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('HELD','EXPIRED','CHECKOUT_PENDING','CONFIRMED','CANCELLED')),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE reservation_seats(reservation_id TEXT NOT NULL,seat_sku TEXT NOT NULL,PRIMARY KEY(reservation_id,seat_sku));
'''

class HoldRejected(Exception):
    pass

def create_hold(db, skus, now, ttl=600, hold_id=None):
    """All-or-nothing hold: no partial reservation on unavailable/missing seats."""
    if not isinstance(skus, list) or not 1 <= len(skus) <= 8 or len(set(skus)) != len(skus):
        raise HoldRejected('Invalid seat selection')
    if any(not isinstance(s, str) or not s.startswith('WM-ST-') for s in skus):
        raise HoldRejected('Invalid seat SKU')
    if not isinstance(now, int) or not 1 <= ttl <= 900:
        raise HoldRejected('Invalid clock or TTL')
    hold_id = hold_id or str(uuid.uuid4())
    expiry = now + ttl
    try:
        db.execute('BEGIN IMMEDIATE')
        # Expired holds can be recovered, but only when the seat has a mapping.
        for sku in skus:
            updated = db.execute('''UPDATE seats SET status='HELD',hold_id=?,hold_expires_at=?
                WHERE sku=? AND shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>''
                AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at<=?))''',
                (hold_id, expiry, sku, now))
            if updated.rowcount != 1:
                raise HoldRejected('Seat unavailable or not mapped: ' + sku)
        db.execute('INSERT INTO reservations(id,status,created_at,expires_at) VALUES(?,?,?,?)',
                   (hold_id, 'HELD', now, expiry))
        db.executemany('INSERT INTO reservation_seats(reservation_id,seat_sku) VALUES(?,?)',
                       [(hold_id, sku) for sku in skus])
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {'reservation_id': hold_id, 'expires_at': expiry, 'skus': skus}

def expire_hold(db, hold_id, now):
    """Only free seats still belonging to this expired reservation."""
    try:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT status,expires_at FROM reservations WHERE id=?', (hold_id,)).fetchone()
        if not row or row[0] != 'HELD' or row[1] > now:
            db.rollback()
            return False
        db.execute('''UPDATE seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL
            WHERE hold_id=? AND status='HELD' AND hold_expires_at<=?''', (hold_id, now))
        db.execute("UPDATE reservations SET status='EXPIRED' WHERE id=? AND status='HELD'", (hold_id,))
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise

def demonstration():
    db = sqlite3.connect(':memory:', isolation_level=None)
    db.executescript(SCHEMA)
    db.executemany('INSERT INTO seats(sku,status,shopify_variant_id) VALUES(?,?,?)',
                   [(f'WM-ST-101-A-{n:02}', 'AVAILABLE', str(n)) for n in range(1, 4)])
    first = create_hold(db, ['WM-ST-101-A-01', 'WM-ST-101-A-02'], 1000, hold_id='demo-first')
    try:
        create_hold(db, ['WM-ST-101-A-02', 'WM-ST-101-A-03'], 1001, hold_id='demo-second')
        raise AssertionError('Double booking was allowed')
    except HoldRejected:
        pass
    assert db.execute("SELECT status FROM seats WHERE sku='WM-ST-101-A-03'").fetchone()[0] == 'AVAILABLE'
    expire_hold(db, 'demo-first', 1600)
    second = create_hold(db, ['WM-ST-101-A-01', 'WM-ST-101-A-02'], 1601, hold_id='demo-second')
    return {'mode': 'LOCAL_SIMULATION_ONLY', 'sales_enabled': False, 'first': first, 'second': second,
            'double_booking_prevented': True, 'partial_holds_prevented': True}

if __name__ == '__main__':
    print(json.dumps(demonstration(), indent=2))
