// ============================================================================
// GET /api/hotels?cc=IT&city=Rome&lat=41.89&lon=12.48&checkin=2026-11-03&checkout=2026-11-14&adults=2
// Live hotel rates from LiteAPI for one room, around the city centre
// (6 km; widened to 20 km when fewer than 3 hotels are found there).
// Returns price per room per night (USD) for three tiers:
//   budget   = cheapest decent hotel (7+/10, 20+ reviews)
//   standard = typical pick: median of the most-reviewed, well-rated 3–4★ hotels
//   luxury   = cheapest hotel in the luxury segment (5★, else top-rated 4★)
// With fewer than 3 hotels every real price is still used:
//   1 hotel  -> all tiers = that hotel
//   2 hotels -> budget = cheaper one, standard and luxury = pricier one
// count = hotels found (shown to the user), radiusKm = search radius used.
// book.url = our booking site's list of hotels in the city (&city=, &country=),
// cheapest first (luxury: most stars first), for the dates and group size (&travelers=); falls back to the
// tier's example hotel. Rates are cached at the edge for 1 hour; the booking
// links are added after the cache.
// ============================================================================
import { cached, json, isDate } from '../_lib/cache.js';

const API = 'https://api.liteapi.travel/v3.0/hotels/rates';
const PLACES = 'https://api.liteapi.travel/v3.0/data/places';
const TTL = 3600;

// Our LiteAPI whitelabel booking site (bookings there earn our commission)
const WHITELABEL = 'https://waybudget.nuitee.link';

/* Rooms for a group: 2 adults per room, e.g. 5 travelers -> [2, 2, 1] */
function rooms(travelers) {
    const out = [];
    for (let left = travelers; left > 0; left -= 2) out.push({ adults: Math.min(2, left) });
    return out;
}

/* Whitelabel list of hotels in the city: cheapest first (sorting=2),
   best rated first (7) or most stars first (5) */
function listUrl(place, p, travelers, sorting = 2) {
    if (!place || !place.id) return null;
    const r = rooms(travelers).map(x => ({ adults: x.adults, children: [] }));
    return `${WHITELABEL}/hotels?placeId=${encodeURIComponent(place.id)}&name=${encodeURIComponent(place.name || '')}` +
           `&checkin=${p.checkin}&checkout=${p.checkout}&rooms=${r.length}&adults=${travelers}` +
           `&occupancies=${encodeURIComponent(btoa(JSON.stringify(r)))}&sorting=${sorting}`;
}

/* Google place id of the city, which the whitelabel search needs */
async function findPlace(env, city, country) {
    if (!city) return null;
    try {
        const url = `${PLACES}?textQuery=${encodeURIComponent(country ? `${city}, ${country}` : city)}`;
        const res = await fetch(url, { headers: { 'X-API-Key': env.LITEAPI_KEY, accept: 'application/json' } });
        if (!res.ok) return null;
        const first = ((await res.json()).data || [])[0];
        return first && first.placeId ? { id: first.placeId, name: city } : null;
    } catch (e) {
        return null;
    }
}

/* Whitelabel hotel page for the same dates and group */
function bookingUrl(hotelId, p, travelers) {
    if (!hotelId) return null;
    const occ = btoa(JSON.stringify(rooms(travelers)));
    return `${WHITELABEL}/hotels/${encodeURIComponent(hotelId)}?checkin=${p.checkin}` +
           `&checkout=${p.checkout}&occupancies=${encodeURIComponent(occ)}`;
}

function nightsBetween(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

async function fetchRates(env, p, radius) {
    const body = {
        checkin: p.checkin,
        checkout: p.checkout,
        currency: 'USD',
        guestNationality: 'US',
        occupancies: [{ adults: p.adults }],
        latitude: p.lat,
        longitude: p.lon,
        radius,
        limit: 200,
        maxRatesPerHotel: 1,
        includeHotelData: true,
        timeout: 4             // seconds suppliers may take; slower ones are skipped
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
    const city = (q.get('city') || '').slice(0, 80), country = (q.get('country') || '').slice(0, 80);
    if (!isFinite(p.lat) || !isFinite(p.lon) || !isDate(p.checkin) || !isDate(p.checkout)) {
        return json({ error: 'lat, lon, checkin, checkout are required' }, 400);
    }
    const nights = nightsBetween(p.checkin, p.checkout);
    if (nights < 1 || nights > 60) return json({ error: 'invalid stay length' }, 400);
    if (!env.LITEAPI_KEY) return json({ error: 'Hotel API is not configured' }, 503);

    const travelers = Math.min(20, Math.max(1, parseInt(q.get('travelers'), 10) || p.adults));

    const res = await cached(context, TTL, async () => {
        try {
            const place = findPlace(env, city, country);          // in parallel
            // Not hotels: campsites, caravan parks
            const NOT_HOTEL = /camping|campsite|campground|caravan|glamping|\bcamp\b/i;
            const hotelsWithin = async radius => {
                const r = await fetchRates(env, p, radius);
                const info = new Map((r.hotels || []).map(h => [h.id, h]));
                const out = [];
                for (const entry of r.data || []) {
                    const total = offerTotal(entry);
                    if (!total) continue;
                    const h = info.get(entry.hotelId) || entry.hotel || {};
                    if (NOT_HOTEL.test(h.name || '')) continue;
                    out.push({
                        id: entry.hotelId || h.id || null,
                        name: h.name || null,
                        stars: Number(h.stars ?? h.starRating) || null,
                        rating: Number(h.rating) || null,
                        reviews: Number(h.review_count) || 0,
                        lat: Number(h.latitude) || null,
                        lon: Number(h.longitude) || null,
                        perNight: Math.round((total / nights) * 100) / 100
                    });
                }
                return out;
            };
            let radiusKm = 6;
            let list = await hotelsWithin(6000);
            if (list.length < 3) {
                const wider = await hotelsWithin(20000);
                if (wider.length > list.length) { list = wider; radiusKm = 20; }
            }
            const placeInfo = await place;
            const tier = h => ({ perNight: h.perNight,
                                 example: h.name ? { id: h.id, name: h.name, stars: h.stars, rating: h.rating,
                                                     lat: h.lat, lon: h.lon } : null });
            const base = { currency: 'USD', nights, count: list.length, radiusKm, place: placeInfo,
                           source: 'LiteAPI live rates' };
            if (!list.length) return { found: false, ...base };
            if (list.length < 3) {
                const [lo, hi] = list.slice().sort((a, b) => a.perNight - b.perNight);
                const top = hi || lo;
                return { found: true, ...base, budget: tier(lo), standard: tier(top), luxury: tier(top) };
            }

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
            // ...that is clearly above the typical pick (some "5★" are cheap)
            const floor = standardHotel.perNight * 1.15;
            const luxAbove = lux ? lux.filter(h => h.perNight >= floor) : [];
            const pricier = byPrice(list).filter(h => h.perNight >= floor);
            const luxuryHotel = luxAbove.length ? minOf(luxAbove)
                : pricier.length ? pricier[Math.floor((pricier.length - 1) / 2)]
                : byPrice(list)[list.length - 1];

            return { found: true, ...base,
                     budget: tier(budgetHotel), standard: tier(standardHotel), luxury: tier(luxuryHotel) };
        } catch (e) {
            return { error: e.message };
        }
    }, ['travelers', 'city', 'country']);

    // Add booking links for this visitor's group size (not part of the cache)
    const data = await res.clone().json().catch(() => null);
    if (!data || !data.found) return res;
    for (const t of ['budget', 'standard', 'luxury']) {
        // budget: cheapest first, standard: best rated first, luxury: most stars first
        const list = listUrl(data.place, p, travelers, { budget: 2, standard: 7, luxury: 5 }[t]);
        const ex = data[t] && data[t].example;
        const url = list || (ex && bookingUrl(ex.id, p, travelers));
        if (url) data[t].book = { url, list: !!list, provider: 'LiteAPI' };
    }
    return json(data, 200, TTL);
}
