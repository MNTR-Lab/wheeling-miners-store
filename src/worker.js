import { handleSeatApi } from './seat-api.js';

/**
 * V37: preserve the existing static storefront; only /api/seats/* is handled here.
 * All seats remain UNRELEASED. No checkout or reservation endpoint is enabled.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/seats/')) {
      try {
        return (await handleSeatApi(request, env)) ?? new Response('Not found', { status: 404 });
      } catch (error) {
        console.error('Seat inventory read error', error);
        return new Response(JSON.stringify({error:'Seat inventory temporarily unavailable'}), {
          status:503,
          headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
        });
      }
    }
    return env.ASSETS.fetch(request);
  }
};
