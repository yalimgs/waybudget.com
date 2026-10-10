// ============================================================================
// GET /api/flights?origin=IST&destination=FCO&depart=2026-11-03&return=2026-11-14
// Round-trip fares per passenger (USD) from the Travelpayouts / Aviasales
// Flight Data API. These are prices real users saw in the last days (cached
// by Aviasales), not a live booking quote.
//   economy:  cheapest fare seen (any number of stops)
//   standard: typical fare = median of fares seen, direct preferred
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
                     one_way: 'false', direct: 'false', ...p }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
        throw new Error(`Travelpayouts ${res.status}: ${body.error || body.message || 'error'}`);
    }
    return body.data || [];
}

const DAY = 86400000;

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

    // Standard: median needs a sample, so widen the date window until there
    // are at least 5 fares; with fewer than 3 fares overall it is left out
    // (the page then estimates it from Economy).
    const sample = pools.find(p => p.length >= 5) || pools[pools.length - 1];
    let standard = null;
    if (sample.length >= 3) {
        const direct = sample.filter(f => f.transfers === 0 && f.return_transfers === 0);
        const base = direct.length >= 3 ? direct : sample;
        standard = base[Math.floor((base.length - 1) / 2)];
        if (standard.price < closest[0].price) standard = closest[0];
    }
    return { economy: fare(closest[0]), standard: standard && fare(standard), fares: sample.length };
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
            // One request returns up to 100 fares (direct and with stops)
            let match = 'exact';
            let list = await query(env, { origin, destination, departure_at: depart, return_at: ret });
            if (!list.length) {
                match = 'month';
                list = await query(env, { origin, destination,
                    departure_at: depart.slice(0, 7), return_at: ret.slice(0, 7) });
            }
            const result = summarize(list, depart, ret);
            if (!result) return { found: false };
            return { found: true, match, currency: 'USD', ...result,
                     source: 'Aviasales (prices seen recently)' };
        } catch (e) {
            return { error: e.message };
        }
    });
}
