-- TEST D1 ONLY. Refresh one existing synthetic hold without explicit SQL transactions.
-- The guarded UPDATE only succeeds for the exact reservation, seat and Shopify variant.
-- This file must be applied only to wheeling-miners-seats-test.
UPDATE reservations
SET expires_at = CAST(strftime('%s','now') AS INTEGER)*1000 + 3600000
WHERE id = 'wm_test_reservation_105_B_01'
  AND status = 'HELD'
  AND shopify_order_id IS NULL
  AND (SELECT COUNT(*) FROM seats
       WHERE sku='WM-ST-105-B-01'
         AND status='HELD'
         AND hold_id='wm_test_reservation_105_B_01'
         AND shopify_order_id IS NULL
         AND shopify_variant_id='gid://shopify/ProductVariant/50931850575929')=1
  AND (SELECT COUNT(*) FROM reservation_seats
       WHERE reservation_id='wm_test_reservation_105_B_01'
         AND seat_sku='WM-ST-105-B-01'
         AND shopify_variant_id='gid://shopify/ProductVariant/50931850575929')=1;
UPDATE seats
SET hold_expires_at=(SELECT expires_at FROM reservations WHERE id='wm_test_reservation_105_B_01'),
    updated_at=CURRENT_TIMESTAMP
WHERE sku='WM-ST-105-B-01'
  AND status='HELD'
  AND hold_id='wm_test_reservation_105_B_01'
  AND shopify_order_id IS NULL
  AND shopify_variant_id='gid://shopify/ProductVariant/50931850575929'
  AND EXISTS (SELECT 1 FROM reservation_seats
      WHERE reservation_id='wm_test_reservation_105_B_01'
        AND seat_sku='WM-ST-105-B-01'
        AND shopify_variant_id='gid://shopify/ProductVariant/50931850575929');
