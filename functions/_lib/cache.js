// Shared helpers for Pages Functions: JSON responses + edge caching.

export function json(data, status = 200, maxAge = 0) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'
        }
    });
}

/**
 * Serves from Cloudflare's edge cache when possible; otherwise runs `produce`
 * and caches successful results for `ttl` seconds. Visitors asking the same
 * question within the TTL never reach the upstream API.
 */
export async function cached(context, ttl, produce) {
    const url = new URL(context.request.url);
    url.searchParams.delete('raw');
    url.searchParams.sort();
    const key = new Request(url.toString());
    const cache = caches.default;

    const hit = await cache.match(key);
    if (hit) return hit;

    const data = await produce();
    const response = json(data, 200, ttl);
    if (!data.error) context.waitUntil(cache.put(key, response.clone()));
    return response;
}

export const isIata = s => /^[A-Z]{3}$/.test(s || '');
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
