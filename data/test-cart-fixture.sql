-- TEST D1 ONLY. One synthetic HELD seat; no production writes or public checkout.
-- Run once after explicit approval; do not rerun against an existing fixture.
INSERT INTO seats (sku,section,row_label,seat_number,price_cents,status,hold_id,hold_expires_at,shopify_variant_id)
VALUES ('WM-ST-105-B-01','105','B',1,100,'HELD','wm_test_reservation_105_B_01',CAST(strftime('%s','now') AS INTEGER)*1000+3600000,'gid://shopify/ProductVariant/50931850575929');
INSERT INTO reservations (id,status,created_at,checkout_nonce,expires_at,shopify_order_id)
VALUES ('wm_test_reservation_105_B_01','HELD',CAST(strftime('%s','now') AS INTEGER)*1000,'wm_test_checkout_nonce_105_B_01_2026',CAST(strftime('%s','now') AS INTEGER)*1000+3600000,NULL);
INSERT INTO reservation_seats (reservation_id,seat_sku,shopify_variant_id)
VALUES ('wm_test_reservation_105_B_01','WM-ST-105-B-01','gid://shopify/ProductVariant/50931850575929');
