// ============================================================================
// Cloudflare Pages Function: GET /api/fx
// Returns current exchange rates for the display currencies (1 USD = x).
// Source: fawazahmed0/currency-api (free, no key, updated daily).
// Cached at Cloudflare's edge for 1 hour, so visitors never wait on the source
// and the source is hit at most a few times per hour worldwide.
// ============================================================================

const CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY'];
const CACHE_SECONDS = 3600;
const SOURCES = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json'
];

export async function onRequestGet(context) {
    const cache = caches.default;
    const cacheKey = new Request(new URL('/api/fx', context.request.url).toString());

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    for (const url of SOURCES) {
        try {
            const res = await fetch(url, { cf: { cacheTtl: CACHE_SECONDS } });
            if (!res.ok) continue;
            const data = await res.json();
            const rates = {};
            for (const code of CURRENCIES) {
                const value = data.usd && data.usd[code.toLowerCase()];
                if (typeof value !== 'number' || !(value > 0)) throw new Error(`missing ${code}`);
                rates[code] = Math.round(value * 10000) / 10000;
            }
            const response = new Response(JSON.stringify({ date: data.date, fx: rates }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': `public, max-age=${CACHE_SECONDS}`
                }
            });
            context.waitUntil(cache.put(cacheKey, response.clone()));
            return response;
        } catch (err) {
            // try the next source
        }
    }

    return new Response(JSON.stringify({ error: 'Exchange rates unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}
