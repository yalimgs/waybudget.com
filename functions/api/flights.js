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
    Object.entries({ currency: 'usd', sorting: 'price', unique: 'false', limit: '30',
                     one_way: 'false', ...p }).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { 'X-Access-Token': env.TRAVELPAYOUTS_TOKEN } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
        throw new Error(`Travelpayouts ${res.status}: ${body.error || body.message || 'error'}`);
    }
    return body.data || [];
}

function pick(list) {
    const f = list.filter(x => typeof x.price === 'number').sort((a, b) => a.price - b.price)[0];
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

    if (q.get('raw') === '1') {   // temporary: inspect upstream data while integrating
        try {
            return json({ raw: (await query(env, { origin, destination, departure_at: depart, return_at: ret })).slice(0, 3) });
        } catch (e) { return json({ error: e.message }, 502); }
    }

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
            const economy = pick(any);
            if (!economy) return { found: false };
            return { found: true, match, currency: 'USD', economy, direct: pick(direct),
                     source: 'Aviasales (prices seen recently)' };
        } catch (e) {
            return { error: e.message };
        }
    });
}
