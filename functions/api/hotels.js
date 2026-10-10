// ============================================================================
// GET /api/hotels?cc=IT&city=Rome&lat=41.89&lon=12.48&checkin=2026-11-03&checkout=2026-11-14&adults=2
// Live hotel rates from LiteAPI for one room, around the city centre.
// Returns price per room per night (USD) for three tiers:
//   budget   = cheapest decent hotel (7+/10, 20+ reviews)
//   standard = typical pick: median of the most-reviewed, well-rated 3–4★ hotels
//   luxury   = cheapest hotel in the luxury segment (5★, else top-rated 4★)
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
        limit: 300,
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
                    rating: Number(h.rating) || null,
                    reviews: Number(h.review_count) || 0,
                    perNight: Math.round((total / nights) * 100) / 100
                });
            }
            if (list.length < 3) return { found: false, count: list.length };

            const byPrice = arr => arr.slice().sort((a, b) => a.perNight - b.perNight);
            const minOf = arr => byPrice(arr)[0];
            const medianOf = arr => byPrice(arr)[Math.floor((arr.length - 1) / 2)];

            // Budget: the cheapest hotel that is still decent (7+/10, 20+ reviews)
            const decent = list.filter(h => h.rating >= 7 && h.reviews >= 20);
            const budgetHotel = minOf(decent.length ? decent : list);

            // Standard: what most people book — well-rated 3–4★ hotels, the more
            // popular (most reviewed) half of them, middle price
            let typical = list.filter(h => h.stars >= 3 && h.stars <= 4 && h.rating >= 8);
            if (typical.length < 5) typical = decent.length >= 5 ? decent : list;
            typical = typical.slice().sort((a, b) => b.reviews - a.reviews)
                             .slice(0, Math.max(5, Math.ceil(typical.length / 2)));
            const standardHotel = medianOf(typical);

            // Luxury: the cheapest hotel in the luxury segment
            const lux = [
                list.filter(h => h.stars >= 5 && h.rating >= 8),
                list.filter(h => h.stars >= 5),
                list.filter(h => h.stars >= 4 && h.rating >= 9),
                list.filter(h => h.stars >= 4 && h.rating >= 8.5)
            ].find(arr => arr.length);
            const luxuryHotel = lux ? minOf(lux) : byPrice(list)[Math.round((list.length - 1) * 0.8)];

            const tier = h => ({ perNight: h.perNight,
                                 example: h.name ? { name: h.name, stars: h.stars, rating: h.rating } : null });
            return {
                found: true, currency: 'USD', nights, count: list.length,
                budget: tier(budgetHotel), standard: tier(standardHotel), luxury: tier(luxuryHotel),
                source: 'LiteAPI live rates'
            };
        } catch (e) {
            return { error: e.message };
        }
    });
}
