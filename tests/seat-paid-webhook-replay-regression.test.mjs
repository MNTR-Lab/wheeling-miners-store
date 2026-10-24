import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';

import {
  handleShopifyPaidWebhook
} from '../src/seat-shopify-webhook.js';

import {
  preparePaidCommit,
  executePaidCommit
} from '../src/seat-paid-commit.js';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const SECRET = 'wheeling-test-only-secret';
const RESERVATION_ID = 'wm_test_reservation_105_B_01';
const NONCE = 'wm_test_checkout_nonce_105_B_01_2026';
const SKU = 'WM-ST-105-B-01';
const VARIANT_ID = '50931850575929';
const VARIANT_GID =
  `gid://shopify/ProductVariant/${VARIANT_ID}`;
const ORDER_ID = '18969898221625';

function createOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    line_items: [
      {
        sku: SKU,
        variant_id: Number(VARIANT_ID),
        quantity: 1
      }
    ],
    note_attributes: [
      {
        name: 'wm_reservation_id',
        value: RESERVATION_ID
      },
      {
        name: 'wm_checkout_nonce',
        value: NONCE
      }
    ],
    ...overrides
  };
}

function createReservation(overrides = {}) {
  return {
    id: RESERVATION_ID,
    status: 'HELD',
    checkout_nonce: NONCE,
    shopify_order_id: null,
    expires_at: Date.now() + 3600000,
    ...overrides
  };
}

function createSeat(overrides = {}) {
  return {
    sku: SKU,
    status: 'HELD',
    shopify_variant_id: VARIANT_GID,
    shopify_order_id: null,
    hold_id: RESERVATION_ID,
    hold_expires_at: Date.now() + 3600000,
    ...overrides
  };
}

function reservationSeats() {
  return [
    {
      sku: SKU,
      shopify_variant_id: VARIANT_GID
    }
  ];
}

function signedRequest(order) {
  const raw = JSON.stringify(order);

  const signature = createHmac('sha256', SECRET)
    .update(raw)
    .digest('base64');

  return new Request(
    'https://example.test/api/seats/webhooks/shopify',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-topic': 'orders/paid',
        'x-shopify-hmac-sha256': signature
      },
      body: raw
    }
  );
}

test('valid payment produces a guarded fulfillment plan', () => {
  const plan = preparePaidCommit(
    createOrder(),
    createReservation(),
    reservationSeats(),
    [createSeat()]
  );

  assert.equal(plan.replayed, false);
  assert.equal(plan.orderId, ORDER_ID);
  assert.equal(plan.reservationId, RESERVATION_ID);
  assert.equal(plan.seatCount, 1);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].expectedChanges, 1);
});

test('confirmed order can be replayed without another sale', () => {
  const plan = preparePaidCommit(
    createOrder(),
    createReservation({
      status: 'CONFIRMED',
      shopify_order_id: ORDER_ID
    }),
    reservationSeats(),
    [
      createSeat({
        status: 'SOLD',
        shopify_order_id: ORDER_ID,
        hold_id: null,
        hold_expires_at: null
      })
    ]
  );

  assert.equal(plan.replayed, true);
  assert.equal(plan.operations.length, 0);
});

test('different Shopify order cannot claim sold seat', () => {
  assert.throws(() => {
    preparePaidCommit(
      createOrder({ id: '18969898221626' }),
      createReservation({
        status: 'CONFIRMED',
        shopify_order_id: ORDER_ID
      }),
      reservationSeats(),
      [
        createSeat({
          status: 'SOLD',
          shopify_order_id: ORDER_ID,
          hold_id: null,
          hold_expires_at: null
        })
      ]
    );
  });
});

test('incorrect checkout nonce is rejected', () => {
  const order = createOrder({
    note_attributes: [
      {
        name: 'wm_reservation_id',
        value: RESERVATION_ID
      },
      {
        name: 'wm_checkout_nonce',
        value: 'incorrect_checkout_nonce_123456'
      }
    ]
  });

  assert.throws(() => {
    preparePaidCommit(
      order,
      createReservation(),
      reservationSeats(),
      [createSeat()]
    );
  });
});

test('expired reservation is rejected', () => {
  assert.throws(() => {
    preparePaidCommit(
      createOrder(),
      createReservation({
        expires_at: Date.now() - 60000
      }),
      reservationSeats(),
      [createSeat()]
    );
  });
});

test('wrong Shopify variant is rejected', () => {
  assert.throws(() => {
    preparePaidCommit(
      createOrder(),
      createReservation(),
      reservationSeats(),
      [
        createSeat({
          shopify_variant_id:
            'gid://shopify/ProductVariant/999999999'
        })
      ]
    );
  });
});

test('fulfillment requires verified webhook signature', async () => {
  const plan = preparePaidCommit(
    createOrder(),
    createReservation(),
    reservationSeats(),
    [createSeat()]
  );

  await assert.rejects(
    executePaidCommit({}, plan, {
      signatureVerified: false
    })
  );
});

test('replayed fulfillment performs no database writes', async () => {
  const plan = preparePaidCommit(
    createOrder(),
    createReservation({
      status: 'CONFIRMED',
      shopify_order_id: ORDER_ID
    }),
    reservationSeats(),
    [
      createSeat({
        status: 'SOLD',
        shopify_order_id: ORDER_ID,
        hold_id: null,
        hold_expires_at: null
      })
    ]
  );

  let writes = 0;

  const db = {
    prepare() {
      writes++;
      throw new Error('Replay must not write');
    },
    batch() {
      writes++;
      throw new Error('Replay must not write');
    }
  };

  const result = await executePaidCommit(db, plan, {
    signatureVerified: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.replayed, true);
  assert.equal(writes, 0);
});

test('fulfillment remains disabled by default', async () => {
  const order = createOrder();

  const response = await handleShopifyPaidWebhook(
    signedRequest(order),
    {
      SHOPIFY_WEBHOOK_SECRET: SECRET,
      SEAT_PAID_FULFILLMENT_ENABLED: 'false',
      SEAT_DB: {
        prepare() {
          return {
            bind() {
              return {
                first: async () => null,
                all: async () => ({ results: [] })
              };
            }
          };
        }
      }
    }
  );

  assert.equal(response.status, 503);

  const body = await response.json();

  assert.equal(
    body.error,
    'MANUAL_RECONCILIATION_REQUIRED'
  );
});
