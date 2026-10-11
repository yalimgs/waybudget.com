// ============================================================================
// GET /api/flights?origin=IST&destination=FCO&depart=2026-11-03&return=2026-11-14
// Round-trip fares per passenger (USD) from the Travelpayouts / Aviasales
// Flight Data API. These are prices real users saw in the last days (cached
// by Aviasales), not a live booking quote.
//   economy:  cheapest fare seen (any number of stops)
//   standard: typical fare = median of fares seen, direct preferred
//   business: cheapest business-class fare seen (null if none)
//   book:     where to send the user to book ({ url with {adults}, maxAdults })
// Exact dates are tried first; if nothing was seen for those dates, the
// cheapest fares seen for the same months are returned (match: "month").
// Responses are cached at the edge for 6 hours.
// ============================================================================
import { cached, json, isIata, isDate } from '../_lib/cache.js';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

// Travelpayouts partner marker: bookings via our links are credited to WayBudget
const TP_MARKER = '787962';

/*
 * Where "See flights" sends the user: Aviasales search for the same route and
 * dates, tagged with our marker. {adults} is filled in by the page (1–9), so
 * this cached response stays the same for every group size.
 * Format: /search/IST1011FCO15112 = IST on 10 Nov, FCO back on 15 Nov, 2 adults.
 */
function bookingLink(origin, destination, depart, ret) {
    const ddmm = iso => iso.slice(8, 10) + iso.slice(5, 7);
    return {
        url: `https://www.aviasales.com/search/${origin}${ddmm(depart)}${destination}${ddmm(ret)}{adults}?marker=${TP_MARKER}`,
        maxAdults: 9,
        provider: 'Aviasales'
    };
}
const TTL = 6 * 3600;

async function query(env, p) {
    const url = new URL(API);
    Object.entries({ currency: 'usd', sorting: 'price', unique: 'false', limit: '100',
                     one_way: 'false', direct: 'false', ...p }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
        throw new Error(`Travelpayouts ${res.status}: ${body.error || body.message || 'error'}`);
    }
    return body.data || [];
}

const DAY = 86400000;
const LATEST = 'https://api.travelpayouts.com/aviasales/v3/get_latest_prices';

/*
 * Cheapest business-class round trip seen for the departure month, preferring
 * trips close to the requested dates. Business data only exists on routes
 * people search often; null when nothing was seen.
 */
async function business(env, origin, destination, depart, ret) {
    const url = new URL(LATEST);
    Object.entries({ origin, destination, beginning_of_period: depart.slice(0, 7) + '-01',
                     period_type: 'month', one_way: 'false', trip_class: '1', currency: 'usd',
                     sorting: 'price', limit: '100', page: '1' })
        .forEach(([k, v]) => url.searchParams.set(k, v));
    try {
        const res = await fetch(url, { headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN } });
        if (!res.ok) return null;
        const body = await res.json();
        const want = { dep: Date.parse(depart), len: (Date.parse(ret) - Date.parse(depart)) / DAY };
        const fares = (body.data || [])
            .filter(f => Number(f.trip_class) === 1 && f.value > 0 && f.depart_date && f.return_date)
            .map(f => {
                const dep = Date.parse(f.depart_date);
                const len = (Date.parse(f.return_date) - dep) / DAY;
                return { f, near: Math.abs(dep - want.dep) / DAY <= 10 && Math.abs(len - want.len) <= 4 };
            });
        const pool = fares.some(x => x.near) ? fares.filter(x => x.near) : fares;
        const best = pool.sort((a, b) => a.f.value - b.f.value)[0];
        return best ? { price: best.f.value, transfers: best.f.number_of_changes ?? null,
                        departureAt: best.f.depart_date, returnAt: best.f.return_date } : null;
    } catch (e) {
        return null;
    }
}

function fare(f) {
    return {
        price: f.price,
        airline: f.airline || null,
        transfers: f.transfers ?? null,
        returnTransfers: f.return_transfers ?? null,
        departureAt: f.departure_at || null,
        returnAt: f.return_at || null,
        duration: f.duration || null,
        link: f.link ? `https://www.aviasales.com${f.link}` : null
    };
}

/*
 * From all fares seen, keep the ones closest to the requested trip (a 2-day
 * trip on the 10th says little about an 11-day trip on the 3rd), then:
 *   economy  = cheapest of them
 *   standard = median of them, using direct flights when there are enough
 */
function summarize(list, depart, ret) {
    const want = { dep: Date.parse(depart), len: (Date.parse(ret) - Date.parse(depart)) / DAY };
    const all = list.filter(x => typeof x.price === 'number' && x.departure_at && x.return_at)
        .map(x => {
            const dep = Date.parse(x.departure_at.slice(0, 10));
            const len = (Date.parse(x.return_at.slice(0, 10)) - dep) / DAY;
            return { x, dDep: Math.abs(dep - want.dep) / DAY, dLen: Math.abs(len - want.len) };
        });
    const tiers = [f => f.dDep <= 4 && f.dLen <= 2, f => f.dDep <= 10 && f.dLen <= 4,
                   f => f.dLen <= 5, () => true];
    const pools = tiers.map(ok => all.filter(ok).map(f => f.x).sort((a, b) => a.price - b.price));

    // Economy: cheapest among the closest matches
    const closest = pools.find(p => p.length);
    if (!closest) return null;

    // "What most people buy": direct flights if there are enough of them,
    // otherwise the fares with the fewest stops; middle of that range
    // (ignores rock-bottom promos and last-minute extremes).
    const stops = f => Math.max(f.transfers || 0, f.return_transfers || 0);
    const median = arr => {
        const fewest = Math.min(...arr.map(stops));
        const direct = arr.filter(f => stops(f) === 0);
        const base = direct.length >= 3 ? direct : arr.filter(f => stops(f) === fewest);
        const pick = base.length >= 3 ? base : arr;
        return pick[Math.floor((pick.length - 1) / 2)];
    };
    const economy = closest[0];

    // Standard = typical fare. Enough fares near the dates: their median.
    if (closest.length >= 3) {
        const m = median(closest);
        if (m.price > economy.price) {
            return { economy: fare(economy), standard: fare(m), fares: closest.length };
        }
    }
    // Otherwise learn how much a typical fare costs over the cheapest one on
    // this route (from a wider date window) and apply that to Economy.
    const sample = pools.find(p => p.length >= 5) || pools[pools.length - 1];
    const ratio = sample.length >= 3 ? median(sample).price / sample[0].price : 0;
    const factor = Math.min(2, Math.max(1.15, ratio || 1.25));
    return {
        economy: fare(economy),
        standard: { price: Math.round(economy.price * factor), derived: true },
        fares: sample.length
    };
}

export async function onRequestGet(context) {
    const { env, request } = context;
    const q = new URL(request.url).searchParams;
    const origin = (q.get('origin') || '').toUpperCase();
    const destination = (q.get('destination') || '').toUpperCase();
    const depart = q.get('depart');
    const ret = q.get('return');

    if (!isIata(origin) || !isIata(destination) || !isDate(depart) || !isDate(ret)) {
        return json({ error: 'origin, destination (IATA) and depart, return (YYYY-MM-DD) are required' }, 400);
    }
    if (!env.TRAVELPAYOUTS_TOKEN) return json({ error: 'Flight API is not configured' }, 503);

    // The booking link needs no upstream call, so it is returned even when
    // fares can't be fetched (the page then shows an estimate + the link)
    const book = bookingLink(origin, destination, depart, ret);

    return cached(context, TTL, async () => {
        try {
            // One request returns up to 100 fares (direct and with stops)
            let match = 'exact';
            const businessFare = business(env, origin, destination, depart, ret);   // in parallel
            let list = await query(env, { origin, destination, departure_at: depart, return_at: ret });
            if (!list.length) {
                match = 'month';
                list = await query(env, { origin, destination,
                    departure_at: depart.slice(0, 7), return_at: ret.slice(0, 7) });
            }
            const result = summarize(list, depart, ret);
            if (!result) return { found: false, book };
            // Sanity check: a business fare far outside 1.3–6× the typical
            // economy fare is more likely a data glitch than a real price
            let biz = await businessFare;
            const ref = result.standard.price;
            if (biz && (biz.price < ref * 1.3 || biz.price > ref * 6)) biz = null;
            return { found: true, match, currency: 'USD', ...result, business: biz, book,
                     source: 'Aviasales (prices seen recently)' };
        } catch (e) {
            // temporary: not cached, so the next visitor tries Aviasales again
            return { found: false, book, temporary: true, reason: e.message };
        }
    });
}
