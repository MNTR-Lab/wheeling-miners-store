#!/usr/bin/env python3
"""V47: Execute a V46 review SQL script against an IN-MEMORY SQLite fixture only.

Never opens a Cloudflare connection or production database. Does not authorize sales.
Usage: python3 tools/simulate-mapping-transaction.py review.sql fixture.json
Fixture: {"seats":[{"sku":...,"section":...,"status":"UNRELEASED","shopify_variant_id":null}, ...]}
"""
import json
import sqlite3
import sys
from pathlib import Path


def simulate(sql: str, fixture: dict) -> dict:
    if not isinstance(fixture, dict) or not isinstance(fixture.get('seats'), list) or not fixture['seats']:
        raise ValueError('Fixture must contain a nonempty seats array')
    if not sql.lstrip().startswith('-- V46 REVIEW ONLY.'):
        raise ValueError('Only V46 review scripts are accepted')
    if sql.count('BEGIN IMMEDIATE;') != 1 or sql.count('COMMIT;') != 1:
        raise ValueError('Expected one guarded transaction')
    db = sqlite3.connect(':memory:')
    try:
        db.execute('CREATE TABLE seats (sku TEXT PRIMARY KEY, section TEXT NOT NULL, status TEXT NOT NULL, shopify_variant_id TEXT, updated_at TEXT)')
        db.executemany('INSERT INTO seats(sku,section,status,shopify_variant_id) VALUES(?,?,?,?)', [
            (x['sku'], x['section'], x['status'], x.get('shopify_variant_id')) for x in fixture['seats']
        ])
        before = db.execute('SELECT sku,section,status,shopify_variant_id FROM seats ORDER BY sku').fetchall()
        db.commit()
        error = None
        try:
            db.executescript(sql)
        except sqlite3.Error as exc:
            error = str(exc)
            db.rollback()
        after = db.execute('SELECT sku,section,status,shopify_variant_id FROM seats ORDER BY sku').fetchall()
        return {
            'mode': 'IN_MEMORY_SQLITE_ONLY', 'committed': error is None,
            'error': error, 'seat_count': len(after),
            'mapped_after': sum(bool(row[3]) for row in after),
            'statuses_unchanged': all(a[2] == b[2] for a, b in zip(before, after)),
            'rolled_back_unchanged': before == after if error else None,
            'sales_enabled': False, 'production_writes': 0,
        }
    finally:
        db.close()


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('Usage: python3 tools/simulate-mapping-transaction.py review.sql fixture.json')
        result = simulate(Path(sys.argv[1]).read_text(), json.loads(Path(sys.argv[2]).read_text()))
        print(json.dumps(result, indent=2))
        if not result['committed'] or not result['statuses_unchanged']:
            sys.exit(1)
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        sys.exit(2)
