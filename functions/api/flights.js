// ============================================================================
// GET /api/flights?origin=IST&destination=FCO&depart=2026-11-03&return=2026-11-14
// Round-trip fares per passenger (USD) from the Travelpayouts / Aviasales
// Flight Data API. These are prices real users saw in the last days (cached
// by Aviasales), not a live booking quote.
//   economy: cheapest fare (any number of stops)
//   direct:  cheapest non-stop fare (null if none found)
// Exact dates are tried first; if nothing was seen for those dates, the
// cheapest fares seen for the same months are returned (match: "month").
// Responses are cached at the edge for 6 hours.
// ============================================================================
import { cached, json, isIata, isDate } from '../_lib/cache.js';

const API = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
const TTL = 6 * 3600;

async function query(env, p) {
    const url = new URL(API);
    Object.entries({ currency: 'usd', sorting: 'price', unique: 'false', limit: '100',
                     one_way: 'false', ...p }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
        throw new Error(`Travelpayouts ${res.status}: ${body.error || body.message || 'error'}`);
    }
    return body.data || [];
}

const DAY = 86400000;

/*
 * Cheapest fare, preferring trips close to the requested dates: in month
 * mode a 2-day trip on the 10th says little about an 11-day trip on the 3rd.
 */
function pick(list, depart, ret) {
    const want = { dep: Date.parse(depart), len: (Date.parse(ret) - Date.parse(depart)) / DAY };
    const fares = list.filter(x => typeof x.price === 'number' && x.departure_at && x.return_at)
        .map(x => {
            const dep = Date.parse(x.departure_at.slice(0, 10));
            const len = (Date.parse(x.return_at.slice(0, 10)) - dep) / DAY;
            return { x, dDep: Math.abs(dep - want.dep) / DAY, dLen: Math.abs(len - want.len) };
        });
    const tiers = [f => f.dDep <= 4 && f.dLen <= 2, f => f.dDep <= 10 && f.dLen <= 4, () => true];
    let f = null;
    for (const ok of tiers) {
        const c = fares.filter(ok).sort((a, b) => a.x.price - b.x.price)[0];
        if (c) { f = c.x; break; }
    }
    if (!f) return null;
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

    return cached(context, TTL, async () => {
        try {
            const base = { origin, destination };
            let match = 'exact';
            let [any, direct] = await Promise.all([
                query(env, { ...base, departure_at: depart, return_at: ret, direct: 'false' }),
                query(env, { ...base, departure_at: depart, return_at: ret, direct: 'true' })
            ]);
            if (!any.length) {
                match = 'month';
                [any, direct] = await Promise.all([
                    query(env, { ...base, departure_at: depart.slice(0, 7), return_at: ret.slice(0, 7), direct: 'false' }),
                    query(env, { ...base, departure_at: depart.slice(0, 7), return_at: ret.slice(0, 7), direct: 'true' })
                ]);
            }
            const economy = pick(any, depart, ret);
            if (!economy) return { found: false };
            let directFare = pick(direct, depart, ret);
            // the cheapest fare may itself be non-stop both ways
            if (economy.transfers === 0 && economy.returnTransfers === 0 &&
                (!directFare || economy.price <= directFare.price)) directFare = economy;
            return { found: true, match, currency: 'USD', economy, direct: directFare,
                     source: 'Aviasales (prices seen recently)' };
        } catch (e) {
            return { error: e.message };
        }
    });
}
