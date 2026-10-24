-- TEST D1 ONLY. Refresh the one previously staged synthetic reservation.
-- Transaction aborts if reservation/seat ownership, variant, or status is wrong.
-- No INSERT/DELETE, Shopify calls, or production changes.
BEGIN TRANSACTION;
CREATE TEMP TABLE refresh_guard (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO refresh_guard(ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM reservations WHERE id='wm_test_reservation_105_B_01' AND status='HELD' AND shopify_order_id IS NULL)=1
  AND (SELECT COUNT(*) FROM seats WHERE sku='WM-ST-105-B-01' AND status='HELD' AND hold_id='wm_test_reservation_105_B_01' AND shopify_order_id IS NULL AND shopify_variant_id='gid://shopify/ProductVariant/50931850575929')=1
  AND (SELECT COUNT(*) FROM reservation_seats WHERE reservation_id='wm_test_reservation_105_B_01' AND seat_sku='WM-ST-105-B-01' AND shopify_variant_id='gid://shopify/ProductVariant/50931850575929')=1
  THEN 1 ELSE 0 END;
UPDATE reservations SET expires_at=(CAST(strftime('%s','now') AS INTEGER)*1000+3600000)
WHERE id='wm_test_reservation_105_B_01' AND (SELECT ok FROM refresh_guard)=1;
UPDATE seats SET hold_expires_at=(SELECT expires_at FROM reservations WHERE id='wm_test_reservation_105_B_01'), updated_at=CURRENT_TIMESTAMP
WHERE sku='WM-ST-105-B-01' AND (SELECT ok FROM refresh_guard)=1;
DROP TABLE refresh_guard;
COMMIT;
