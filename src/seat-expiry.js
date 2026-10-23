/** V112: D1 stores expiry as INTEGER epoch milliseconds. ISO strings accepted for legacy offline fixtures only. */
export function expiryMilliseconds(value) {
  if (Number.isSafeInteger(value) && value > 0) {
    // Epoch seconds and milliseconds both supported for older rows.
    if (value >= 1_000_000_000 && value < 10_000_000_000) return value * 1000;
    if (value >= 1_000_000_000_000 && value < 10_000_000_000_000) return value;
  }
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) {
    const ms=Date.parse(value);
    if(Number.isFinite(ms)) return ms;
  }
  throw Error('INVALID_EXPIRY');
}
export function epochMilliseconds(value) {
  const ms=expiryMilliseconds(value);
  if (!Number.isSafeInteger(ms)) throw Error('INVALID_EXPIRY');
  return ms;
}
