import sqlite3,re,pathlib
sql=pathlib.Path('data/migrations/TEST-inventory-candidate.sql').read_text()
assert sql.count('INSERT INTO seats ')==3735
assert not re.search(r'\b(UPDATE|DELETE|DROP|ALTER|REPLACE)\b', '\n'.join(x for x in sql.splitlines() if not x.startswith('--')),re.I)
assert 'WM-ST-105-B-01' not in sql and 'WM-ST-105-B-02' not in sql
con=sqlite3.connect(':memory:')
con.executescript("CREATE TABLE seats(sku TEXT PRIMARY KEY,section TEXT NOT NULL,row_label TEXT NOT NULL,seat_number INTEGER NOT NULL,price_cents INTEGER NOT NULL,status TEXT NOT NULL,hold_id TEXT,hold_expires_at INTEGER,shopify_order_id TEXT,shopify_variant_id TEXT UNIQUE,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);")
con.execute("INSERT INTO seats(sku,section,row_label,seat_number,price_cents,status,shopify_order_id,shopify_variant_id) VALUES(?,?,?,?,?,?,?,?)",('WM-ST-105-B-01','105','B',1,100,'SOLD','first-paid-order','gid://shopify/ProductVariant/50931850575929'))
con.execute("INSERT INTO seats(sku,section,row_label,seat_number,price_cents,status,shopify_order_id,shopify_variant_id) VALUES(?,?,?,?,?,?,?,?)",('WM-ST-105-B-02','105','B',2,100,'SOLD','18970068058169','gid://shopify/ProductVariant/50943009259577'))
before=con.execute("SELECT sku,status,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE status='SOLD' ORDER BY sku").fetchall()
con.executescript(sql)
after=con.execute("SELECT sku,status,shopify_order_id,shopify_variant_id,price_cents FROM seats WHERE status='SOLD' ORDER BY sku").fetchall()
assert before==after,'Existing paid seats were changed'
assert con.execute('SELECT COUNT(*) FROM seats').fetchone()[0]==3737
assert con.execute('SELECT COUNT(DISTINCT section) FROM seats').fetchone()[0]==63
assert con.execute("SELECT COUNT(*) FROM seats WHERE status='UNRELEASED'").fetchone()[0]==3735
assert con.execute("SELECT COUNT(*) FROM seats WHERE shopify_variant_id IS NULL").fetchone()[0]==0
assert con.execute("SELECT COUNT(DISTINCT shopify_variant_id) FROM seats").fetchone()[0]==3737
assert con.execute("SELECT COUNT(*) FROM seats WHERE status='SOLD'").fetchone()[0]==2
print('PASS: 3,737 mapped seats, 63 sections, 2 sold unchanged, 3,735 unreleased. OFFLINE ONLY.')
