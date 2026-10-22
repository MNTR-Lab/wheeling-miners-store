#!/usr/bin/env python3
"""V61 offline SQLite rehearsal for an atomic reservation protocol.

Never connects to D1, never enables sales, and never modifies live data.
"""
import json
import sqlite3
import sys

SCHEMA = '''
CREATE TABLE seats(sku TEXT PRIMARY KEY,status TEXT NOT NULL,shopify_variant_id TEXT,hold_id TEXT,hold_expires_at INTEGER);
CREATE TABLE reservations(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE reservation_seats(reservation_id TEXT NOT NULL,seat_sku TEXT NOT NULL,PRIMARY KEY(reservation_id,seat_sku));
'''

class ReservationConflict(Exception):
    pass

def atomic_hold(db, skus, hold_id, now, ttl=600):
    if not isinstance(skus, list) or not 1 <= len(skus) <= 8 or len(set(skus)) != len(skus):
        raise ValueError('Invalid selection')
    if not isinstance(hold_id, str) or not hold_id or not isinstance(now, int) or now <= 0 or not 60 <= ttl <= 900:
        raise ValueError('Invalid reservation inputs')
    try:
        db.execute('BEGIN IMMEDIATE')
        # Expire old reservations first, ensuring stale holds are not left active.
        for sku in skus:
            row = db.execute('SELECT hold_id,hold_expires_at FROM seats WHERE sku=? AND status=?', (sku, 'HELD')).fetchone()
            if row and row[1] is not None and row[1] <= now:
                db.execute("UPDATE reservations SET status='EXPIRED' WHERE id=? AND status='HELD' AND expires_at<=?", (row[0], now))
        expires = now + ttl
        db.execute("INSERT INTO reservations(id,status,created_at,expires_at) VALUES(?,'HELD',?,?)", (hold_id, now, expires))
        for sku in skus:
            result = db.execute('''UPDATE seats SET status='HELD',hold_id=?,hold_expires_at=?
                WHERE sku=? AND shopify_variant_id IS NOT NULL AND TRIM(shopify_variant_id)<>''
                AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at<=?))''',
                (hold_id, expires, sku, now))
            if result.rowcount != 1:
                raise ReservationConflict('Seat not available: ' + str(sku))
            db.execute('INSERT INTO reservation_seats(reservation_id,seat_sku) VALUES(?,?)', (hold_id, sku))
        db.commit()
        return {'reservation_id': hold_id, 'expires_at': expires, 'skus': skus}
    except Exception:
        db.rollback()
        raise

def expire_hold(db, hold_id, now):
    try:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT status,expires_at FROM reservations WHERE id=?', (hold_id,)).fetchone()
        if not row or row[0] != 'HELD' or row[1] > now:
            db.rollback()
            return False
        db.execute("UPDATE seats SET status='AVAILABLE',hold_id=NULL,hold_expires_at=NULL WHERE status='HELD' AND hold_id=? AND hold_expires_at<=?", (hold_id, now))
        db.execute("UPDATE reservations SET status='EXPIRED' WHERE id=? AND status='HELD'", (hold_id,))
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise

def demo():
    db = sqlite3.connect(':memory:', isolation_level=None)
    db.executescript(SCHEMA)
    db.executemany('INSERT INTO seats(sku,status,shopify_variant_id) VALUES(?,?,?)',
                   [('WM-ST-101-A-01','AVAILABLE','1001'),('WM-ST-101-A-02','AVAILABLE','1002'),('WM-ST-101-A-03','AVAILABLE','1003')])
    atomic_hold(db,['WM-ST-101-A-01','WM-ST-101-A-02'],'hold-1',1000)
    try:
        atomic_hold(db,['WM-ST-101-A-03','WM-ST-101-A-02'],'hold-2',1001)
        raise AssertionError('Overlapping hold succeeded')
    except ReservationConflict:
        pass
    assert db.execute("SELECT status FROM seats WHERE sku='WM-ST-101-A-03'").fetchone()[0]=='AVAILABLE'
    assert db.execute("SELECT COUNT(*) FROM reservations WHERE id='hold-2'").fetchone()[0]==0
    assert expire_hold(db,'hold-1',1600)
    atomic_hold(db,['WM-ST-101-A-01'],'hold-3',1601)
    assert not expire_hold(db,'hold-1',1602)
    assert db.execute("SELECT hold_id FROM seats WHERE sku='WM-ST-101-A-01'").fetchone()[0]=='hold-3'
    return {'version':'V61','mode':'OFFLINE_SQLITE_ONLY','sales_enabled':False,'atomic_rollback':True,'expired_hold_recovery':True,'stale_expiry_protection':True}

if __name__ == '__main__':
    print(json.dumps(demo(),indent=2))
