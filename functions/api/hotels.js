// ============================================================================
// GET /api/hotels?cc=IT&city=Rome&lat=41.89&lon=12.48&checkin=2026-11-03&checkout=2026-11-14&adults=2
// Live hotel rates from LiteAPI for one room, around the city centre.
// Returns price per room per night (USD) for three tiers, derived from the
// spread of available hotels (no star categories needed):
//   budget   ≈ 20th percentile of well-rated hotels
//   standard ≈ median of well-rated hotels
//   luxury   ≈ 80th percentile, preferring 4–5★ hotels
// plus one example hotel per tier. Cached at the edge for 1 hour.
// ============================================================================
import { cached, json, isDate } from '../_lib/cache.js';

const API = 'https://api.liteapi.travel/v3.0/hotels/rates';
const TTL = 3600;

function nightsBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

async function fetchRates(env, p) {
    const body = {
        checkin: p.checkin,
        checkout: p.checkout,
        currency: 'USD',
        guestNationality: 'US',
        occupancies: [{ adults: p.adults }],
        latitude: p.lat,
        longitude: p.lon,
        radius: 8000,
        limit: 200,
        maxRatesPerHotel: 1,
        includeHotelData: true,
        timeout: 8
    };
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'X-API-Key': env.LITEAPI_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 204) return { data: [] };
    if (!res.ok) throw new Error(`LiteAPI ${res.status}: ${data.error?.message || data.message || 'error'}`);
    return data;
}

/* Lowest total price of a hotel's offer, tolerant to response shape */
function offerTotal(entry) {
    let best = Infinity;
    for (const rt of entry.roomTypes || []) {
        const candidates = [
            rt.offerRetailRate?.amount,
            ...(rt.rates || []).map(r => r.retailRate?.total?.[0]?.amount)
        ];
        for (const c of candidates) if (typeof c === 'number' && c > 0 && c < best) best = c;
    }
    return best === Infinity ? null : best;
}

function percentile(sorted, p) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

export async function onRequestGet(context) {
    const { env, request } = context;
    const q = new URL(request.url).searchParams;
    const p = {
        lat: Number(q.get('lat')), lon: Number(q.get('lon')),
        checkin: q.get('checkin'), checkout: q.get('checkout'),
        adults: Math.min(4, Math.max(1, parseInt(q.get('adults'), 10) || 2))
    };
    if (!isFinite(p.lat) || !isFinite(p.lon) || !isDate(p.checkin) || !isDate(p.checkout)) {
        return json({ error: 'lat, lon, checkin, checkout are required' }, 400);
    }
    const nights = nightsBetween(p.checkin, p.checkout);
    if (nights < 1 || nights > 60) return json({ error: 'invalid stay length' }, 400);
    if (!env.LITEAPI_KEY) return json({ error: 'Hotel API is not configured' }, 503);

    if (q.get('raw') === '1') {   // temporary: inspect upstream data while integrating
        try {
            const r = await fetchRates(env, p);
            return json({ keys: Object.keys(r), first: (r.data || []).slice(0, 2),
                          hotelsSample: (r.hotels || []).slice(0, 2), count: (r.data || []).length });
        } catch (e) { return json({ error: e.message }, 502); }
    }

    return cached(context, TTL, async () => {
        try {
            const r = await fetchRates(env, p);
            const info = new Map((r.hotels || []).map(h => [h.id, h]));
            const list = [];
            for (const entry of r.data || []) {
                const total = offerTotal(entry);
                if (!total) continue;
                const h = info.get(entry.hotelId) || entry.hotel || {};
                list.push({
                    name: h.name || null,
                    stars: Number(h.stars ?? h.starRating) || null,
                    rating: Number(h.rating ?? h.reviewScore) || null,
                    perNight: Math.round((total / nights) * 100) / 100
                });
            }
            if (list.length < 3) return { found: false, count: list.length };

            const byPrice = arr => arr.slice().sort((a, b) => a.perNight - b.perNight);
            const rated = list.filter(h => h.rating === null || h.rating >= 7);
            const pool = rated.length >= 5 ? rated : list;
            const upscale = list.filter(h => (h.stars || 0) >= 4);
            const luxuryPool = upscale.length >= 3 ? upscale : pool;

            const tier = (arr, pct) => {
                const s = byPrice(arr);
                const h = percentile(s, pct);
                return { perNight: h.perNight, example: h.name ? { name: h.name, stars: h.stars, rating: h.rating } : null };
            };
            return {
                found: true, currency: 'USD', nights, count: list.length,
                budget: tier(pool, 0.2), standard: tier(pool, 0.5), luxury: tier(luxuryPool, 0.8),
                source: 'LiteAPI live rates'
            };
        } catch (e) {
            return { error: e.message };
        }
    });
}
