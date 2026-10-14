// ============================================================================
// Module: budget.js
// Purpose: Trip budget model. Turns route + dates + travelers into line items.
//
// How the estimates work
//   Every base cost below is a typical US price (USD). It is scaled to the
//   destination with the country's price level from data/prices.json
//   (USA = 1.0, Turkey ≈ 0.34, France ≈ 0.74 ...). Tourist prices vary less
//   between countries than general prices, so the level is softened with an
//   exponent (level ^ 0.75 means a country at 0.34 costs ~45% of the US).
//
//   Flights and hotels use these estimates only as a fallback until live
//   prices are connected; food and airport transfers are always estimates.
// ============================================================================

const BUDGET_MODEL = {
    // Choices offered per line item: [key, label]
    options: {
        flights:  [['economy', 'Economy'], ['standard', 'Standard'], ['premium', 'Premium'], ['none', 'None']],
        hotel:    [['budget', 'Budget'], ['standard', 'Standard'], ['luxury', 'Luxury'], ['none', 'None']],
        food:     [['budget', 'Street food'], ['standard', 'Casual'], ['luxury', 'Fine dining'], ['none', 'None']],
        transfer: [['transit', 'Public'], ['taxi', 'Taxi'], ['private', 'Private'], ['none', 'None']],
        local:    [['public', 'Public'], ['mixed', 'Mixed'], ['taxi', 'Taxi'], ['none', 'None']]
    },
    // Quick presets for the Budget / Standard / Luxury tabs
    presets: {
        budget:   { flights: 'economy', hotel: 'budget', food: 'budget', transfer: 'transit', local: 'public' },
        standard: { flights: 'standard', hotel: 'standard', food: 'standard', transfer: 'taxi', local: 'mixed' },
        luxury:   { flights: 'premium', hotel: 'luxury', food: 'luxury', transfer: 'private', local: 'taxi' }
    },

    // All "US base" amounts are US prices of August 2026; they are scaled by
    // US inflation since then (prices.json → baseFactor, refreshed weekly).

    // Hotel: price per room per night (US base), 2 travelers per room
    hotelNight:   { budget: 90, standard: 170, luxury: 380 },
    hotelExp: 0.7,
    peoplePerRoom: 2,
    bigCityHotelFactor: 1.2,          // cities with a major airport

    // Food: per person per day (US base): breakfast, lunch, dinner, drinks/snacks
    foodDay:      { budget: 35, standard: 70, luxury: 130 },
    foodExp: 0.75,
    // How strongly each tier follows the local price level: street food tracks
    // local prices closely, fine dining is closer to international prices
    // (checked against Istanbul, Rome, Zurich, Bangkok and India, Oct 2026)
    foodTierExp: { budget: 1.25, standard: 1.1, luxury: 0.8 },
    bigCityFoodFactor: 1.15,

    // Getting around the city during the stay: per person per day (US base)
    localDay:     { public: 6, mixed: 12, taxi: 30 },
    localExp: 0.8,

    // Airport <-> hotel, each way
    taxiFlag: 4, taxiPerKm: 1.9,      // US base, per car (up to 4 people)
    peoplePerCar: 4,
    roadFactor: 1.3,                  // road distance vs straight line
    privateFactor: 1.6,               // pre-booked private car vs street taxi
    transitTrip: 6,                   // US base airport train/bus per person
    transitExp: 0.8,

    // Flight fallback: economy round trip per person by great-circle distance
    flight: { base: 80, shortPerKm: 0.09, longFrom: 3000, longPerKm: 0.065 },
    // Economy = cheapest (often with stops), Standard = direct economy,
    // Premium = business class (multiple of economy, larger on long haul)
    flightFactor: { economy: 0.85, standard: 1 },
    businessFactor: [[1500, 2.5], [4000, 3], [Infinity, 4]],   // [up to km, × standard fare]
    standardFallbackFactor: 1.25,     // too few fares seen: typical ≈ cheapest × 1.25
    smallAirportFactor: 1.4,          // no fares at all and a small airport: connections cost more

    defaultLevel: 0.5                 // countries with no price data
};

let priceData = null;
const pricesReady = fetch('data/prices.json')
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => { priceData = data; })
    .catch(err => console.error('Price data could not be loaded:', err));

/*
 * Live exchange rates from /api/fx (edge-cached for an hour). Loaded in the
 * background: the page works immediately with the rates bundled in
 * data/prices.json and switches to fresh rates as soon as they arrive.
 */
const fxReady = pricesReady
    .then(() => fetch('/api/fx'))
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
        if (priceData && data.fx) {
            priceData.fx = { ...priceData.fx, ...data.fx };
            priceData.fxDate = data.date || priceData.fxDate;
            priceData.fxLive = true;
            document.dispatchEvent(new CustomEvent('fx:update'));
        }
    })
    .catch(() => { /* keep bundled rates */ });

function priceLevel(countryCode) {
    return (priceData && priceData.level[countryCode]) || BUDGET_MODEL.defaultLevel;
}

function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
              Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Rough economy round-trip fare per person from distance alone.
 */
/** US inflation since the base costs were set (refreshed weekly in prices.json). */
function baseFactor() {
    return (priceData && priceData.baseFactor) || 1;
}

function estimateFlightPerPerson(km, tier) {
    const f = BUDGET_MODEL.flight;
    const fare = baseFactor() * (km <= f.longFrom
        ? f.base + km * f.shortPerKm
        : f.base + f.longFrom * f.shortPerKm + (km - f.longFrom) * f.longPerKm);
    if (tier === 'premium') {
        const [, factor] = BUDGET_MODEL.businessFactor.find(([maxKm]) => km <= maxKm);
        return fare * factor;
    }
    return fare * BUDGET_MODEL.flightFactor[tier];
}

/**
 * Builds the budget.
 * trip    = { origin, destination, nights, travelers }
 * choices = { flights, hotel, food, transfer, local }  (option keys from BUDGET_MODEL.options)
 * live    = optional { flights: {perPerson, source}, hotel: {perNight, source} }
 * Returns { items: [...], total, perPerson }. All amounts in USD.
 */
function calculateBudget(trip, choices, live = {}) {
    const M = BUDGET_MODEL;
    const { origin, destination, nights, travelers } = trip;
    const days = nights + 1;
    // country price level × US inflation since the base costs were set
    const level = priceLevel(destination.cc);
    const inf = baseFactor();
    const big = destination.l === 1;
    const rooms = Math.ceil(travelers / M.peoplePerRoom);
    const cars = Math.ceil(travelers / M.peoplePerCar);

    const items = [];

    // ---- Flights
    const km = distanceKm(origin, destination);
    const route = t('Round trip {a} ⇄ {b}', { a: origin.a[0], b: destination.a[0] });
    // "closest fare seen: 10–12 Nov" when a fare is not for the exact dates asked
    const dateNote = f => {
        if (!f || !f.departureAt || !f.returnAt) return '';
        const dep = f.departureAt.slice(0, 10), ret = f.returnAt.slice(0, 10);
        if (dep === trip.start && ret === trip.end) return '';
        return ' · ' + t('closest fare seen: {dates}', { dates: shortRange(dep, ret) });
    };
    const fl = live.flights && live.flights.found ? live.flights : null;
    const via = !fl && live.flights && live.flights.via && live.flights.via.main ? live.flights.via : null;
    // "only 1 fare found" / "2 fares found" / "14 fares found"
    const fareCount = n => n === 1 ? t('only 1 fare found') : t('{n} fares found', { n });
    if (fl) {
        let perPerson, kind = 'live', info, source;
        if (choices.flights === 'economy') {
            perPerson = fl.economy.price;
            info = describeFare(fl.economy) + dateNote(fl.economy);
            source = t('Lowest of {n} fares seen recently (Aviasales)', { n: fl.fares });
        } else if (choices.flights === 'standard') {
            perPerson = fl.standard.price;
            info = describeFare(fl.standard) + dateNote(fl.standard);
            source = fl.fares >= 3 ? t('Typical (median) of {n} fares seen recently (Aviasales)', { n: fl.fares })
                                   : t('Pricier of the fares seen recently (Aviasales)');
            if (fl.standard.derived) kind = 'estimate';        // older cached answers
        } else if (fl.business) {
            perPerson = fl.business.price;
            info = t('Business class') + (fl.business.transfers != null ? ` · ${stopsText(fl.business.transfers)}` : '') +
                   dateNote(fl.business);
            source = t('Lowest business-class fare seen recently (Aviasales)');
        } else {
            const [, factor] = M.businessFactor.find(([maxKm]) => km <= maxKm);
            perPerson = fl.standard.price * factor;
            kind = 'estimate'; info = t('Business class');
            source = t('Estimated from live economy fares');
        }
        items.push({
            key: 'flights', label: 'Flights',
            detail: `${route} · ${[info, fareCount(fl.fares)].filter(Boolean).join(' · ')} · ${travelers} × ${money(perPerson)}`,
            amount: perPerson * travelers, kind, source, link: bookingLink(fl.book, travelers), linkLabel: 'See flights'
        });
    } else if (via) {
        // Two flights through a bigger airport: the long one has live fares,
        // the short domestic one is live if seen, else estimated from distance
        const hubPos = airportPos(via.hub);
        const smallEnd = via.side === 'dest' ? destination : origin;
        const legKm = hubPos ? distanceKm(hubPos, { lat: smallEnd.al[0], lon: smallEnd.al[1] }) : km * 0.2;
        const tier = choices.flights === 'economy' ? 'economy' : 'standard';
        const other = via.other ? via.other[tier].price : estimateFlightPerPerson(legKm, tier);
        let perPerson = via.main[tier].price + other;
        if (choices.flights === 'premium') {
            const [, factor] = M.businessFactor.find(([maxKm]) => km <= maxKm);
            perPerson *= factor;
        }
        const [a, b] = via.side === 'dest' ? [origin.a[0], via.hub] : [via.hub, destination.a[0]];
        items.push({
            key: 'flights', label: 'Flights',
            detail: `${route} · ` + t('via {hub}', { hub: via.hub }) + ' · ' +
                    t(via.other ? 'no fares for this route, priced as 2 flights'
                                : 'no fares for this route, live fare {a}–{b} + domestic flight estimate', { a, b }) +
                    ` · ${travelers} × ${money(perPerson)}`,
            amount: perPerson * travelers, kind: 'estimate',
            source: t('{a} ⇄ {b}: {n} fares seen recently (Aviasales)', { a, b, n: via.main.fares }),
            link: bookingLink(live.flights.book, travelers), linkLabel: 'See flights'
        });
    } else {
        // Small airports cost more than the distance suggests (connections)
        const small = (origin.l === 0 || destination.l === 0) ? M.smallAirportFactor : 1;
        const perPerson = estimateFlightPerPerson(km, choices.flights) * small;
        items.push({
            key: 'flights', label: 'Flights',
            detail: `${route} · ${Math.round(km).toLocaleString('en')} km` +
                    (live.loadingFlights ? '' : ' · ' + t('no fares found, check the live price')) +
                    ` · ${travelers} × ${money(perPerson)}`,
            amount: perPerson * travelers, kind: live.loadingFlights ? 'loading' : 'rough',
            source: t(live.loadingFlights ? 'Loading live fares' : 'Distance-based estimate (no live fare found)'),
            link: bookingLink(live.flights && live.flights.book, travelers), linkLabel: 'See flights'
        });
    }

    // ---- Accommodation
    const ho = live.hotel && live.hotel.found ? live.hotel[choices.hotel] : null;
    if (ho) {
        const ex = ho.example ? ' · ' + t('e.g. {name}', { name: ho.example.name }) : '';
        const n = live.hotel.count;
        const found = (n === 1 ? t('only 1 hotel found') : t('{n} hotels found', { n })) +
                      (live.hotel.radiusKm > 6 ? ' ' + t('within {km} km', { km: live.hotel.radiusKm }) : '');
        items.push({
            key: 'hotel', label: 'Hotel',
            detail: `${tn(rooms, '{n} room', '{n} rooms')} × ${tn(nights, '{n} night', '{n} nights')} · ` +
                    t('{p}/night', { p: money(ho.perNight) }) + ex + ' · ' + found,
            amount: ho.perNight * rooms * nights, kind: 'live',
            source: t('Live rates for your dates, {n} hotels compared', { n: live.hotel.count }),
            link: (ho.book && ho.book.url) || null, linkLabel: ho.book && ho.book.list ? 'See hotels' : 'See hotel'
        });
    } else {
        const perNight = inf * M.hotelNight[choices.hotel] * level ** M.hotelExp * (big ? M.bigCityHotelFactor : 1);
        items.push({
            key: 'hotel', label: 'Hotel',
            detail: `${tn(rooms, '{n} room', '{n} rooms')} × ${tn(nights, '{n} night', '{n} nights')} · ~` +
                    t('{p}/night', { p: money(perNight) }) +
                    (live.loadingHotel ? '' : ' · ' + t('no live hotel rates found')),
            amount: perNight * rooms * nights, kind: live.loadingHotel ? 'loading' : 'rough',
            source: t(live.loadingHotel ? 'Loading live hotel rates' : 'Price-level estimate (no live rates found)')
        });
    }

    // ---- Food
    // Restaurant price level (World Bank ICP) when known, else the softened overall level
    const foodLevel = (priceData && priceData.food && priceData.food[destination.cc]) || level ** M.foodExp;
    // US restaurant inflation (food away from home) when available, else overall US CPI
    const infFood = (priceData && priceData.foodBaseFactor) || inf;
    const foodDay = infFood * M.foodDay[choices.food] * foodLevel ** (M.foodTierExp[choices.food] || 1) *
                    (big ? M.bigCityFoodFactor : 1);
    items.push({
        key: 'food', label: 'Food & drinks',
        detail: t('{t} × {d} days · ~{p} per person/day', { t: travelers, d: days, p: money(foodDay) }),
        amount: foodDay * travelers * days, kind: 'estimate',
        source: t('Based on the destination country\'s restaurant prices')
    });

    // ---- Airport transfers (both ways)
    // Distance: to the chosen hotel when its location is known, else to the city
    // centre. Road km = straight line × this city's road/straight ratio (from the
    // real airport → centre route), drive time from the same route's speed.
    const cityRoadRatio = destination.rk && destination.d >= 3
        ? Math.min(2, Math.max(1.1, destination.rk / destination.d)) : M.roadFactor;
    const hotelPick = choices.hotel !== 'none' && ho && ho.example && ho.example.lat && destination.al
        ? ho.example : null;
    let roadKm, transferTo;
    if (hotelPick) {
        const straight = distanceKm({ lat: destination.al[0], lon: destination.al[1] },
                                    { lat: hotelPick.lat, lon: hotelPick.lon });
        roadKm = Math.max(3, straight) * cityRoadRatio;
        transferTo = hotelPick.name;
    } else {
        roadKm = destination.rk || Math.max(8, destination.d || 20) * M.roadFactor;
        transferTo = t('city centre');
    }
    const minPerKm = destination.rk && destination.rm ? destination.rm / destination.rk : null;
    const driveMin = minPerKm ? Math.round(roadKm * minPerKm) : null;
    const taxiRide = inf * (M.taxiFlag + M.taxiPerKm * roadKm) * level ** M.transitExp;
    let transfer;
    if (choices.transfer === 'transit') {
        const ride = inf * M.transitTrip * level ** M.transitExp;
        transfer = { amount: ride * travelers * 2,
            detail: `${destination.a[0]} → ${transferTo} · ${t('both ways')} · ${travelers} × ` +
                    t('~{p} per ride', { p: money(ride) }) };
    } else {
        const ride = taxiRide * (choices.transfer === 'private' ? M.privateFactor : 1);
        transfer = { amount: ride * cars * 2,
            detail: `${destination.a[0]} → ${transferTo} · ~${Math.round(roadKm)} km` +
                    (driveMin ? ' ' + t('(~{m} min)', { m: driveMin }) : '') +
                    ` · ${t('both ways')} · ${tn(cars, '{n} car', '{n} cars')} · ` + t('~{p} per ride', { p: money(ride) }) };
    }
    items.push({
        key: 'transfer', label: 'Airport transfers', ...transfer, kind: 'estimate',
        source: hotelPick
            ? t('Distance to the example hotel, estimated from this city\'s road network; taxi fares estimated')
            : destination.rk
                ? t('{c} → city centre: {k} km by road (OpenStreetMap)', { c: destination.a[0], k: Math.round(destination.rk) })
                : t('{c} is ~{k} km from the city centre (straight line)', { c: destination.a[0], k: Math.round(destination.d || 20) })
    });

    // ---- Getting around the city during the stay
    const localDay = inf * M.localDay[choices.local] * level ** M.localExp;
    items.push({
        key: 'local', label: 'Local transport',
        detail: t('{t} × {d} days · ~{p} per person/day', { t: travelers, d: days, p: money(localDay) }),
        amount: localDay * travelers * days, kind: 'estimate',
        source: t('Metro, bus, tram and short rides while sightseeing')
    });

    // Items the traveller removed ("None"): shown, but not counted
    for (const item of items) {
        if (choices[item.key] === 'none') {
            Object.assign(item, { amount: 0, detail: t('Not included'), kind: 'none', source: '' });
        }
    }

    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return { items, total, perPerson: total / travelers };
}

/* ------------------------------------------------------------ Live data -- */

const AIRLINES = {
    VF: 'AJet', PC: 'Pegasus', TK: 'Turkish Airlines', XQ: 'SunExpress', W6: 'Wizz Air', FR: 'Ryanair',
    U2: 'easyJet', LH: 'Lufthansa', AF: 'Air France', KL: 'KLM', BA: 'British Airways', AZ: 'ITA Airways',
    LX: 'SWISS', OS: 'Austrian', A3: 'Aegean', EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad',
    SU: 'Aeroflot', IB: 'Iberia', VY: 'Vueling', TP: 'TAP', SK: 'SAS', AY: 'Finnair', LO: 'LOT',
    DL: 'Delta', UA: 'United', AA: 'American', AC: 'Air Canada', SQ: 'Singapore Airlines',
    CX: 'Cathay Pacific', NH: 'ANA', JL: 'JAL', KE: 'Korean Air', MS: 'EgyptAir', SV: 'Saudia',
    FZ: 'flydubai', G9: 'Air Arabia', J2: 'AZAL', PS: 'UIA', RO: 'TAROM', JU: 'Air Serbia', EW: 'Eurowings',
    HV: 'Transavia', TO: 'Transavia France', DY: 'Norwegian', BT: 'airBaltic', '6E': 'IndiGo', AI: 'Air India'
};

function stopsText(n) {
    return n === 0 ? t('Direct') : tn(n, '{n} stop', '{n} stops');
}

/* "10–12 Nov" or "28 Nov – 2 Dec" in the current language */
/*
 * "See flights" link from the flight API (provider-neutral: the API decides
 * where to book). Null until the API has answered.
 */
function bookingLink(book, travelers) {
    if (!book || !book.url) return null;
    const adults = Math.min(Math.max(travelers, 1), book.maxAdults || 9);
    return book.url.replace('{adults}', adults);
}

function shortRange(depIso, retIso) {
    const d = s => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
    const a = d(depIso), b = d(retIso), loc = dateLocale();
    const mon = x => x.toLocaleDateString(loc, { month: 'short' });
    return a.getMonth() === b.getMonth()
        ? `${a.getDate()}–${b.getDate()} ${mon(b)}`
        : `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
}

/* "Pegasus · Direct", or "Pegasus · 1 stop out, direct back" when the legs differ */
function describeFare(f) {
    const airline = AIRLINES[f.airline] || f.airline || '';
    const out = f.transfers, back = f.returnTransfers;
    let stops = '';
    if (out != null && back != null) {
        stops = out === back ? stopsText(out)
            : t('{out} out, {back} back', { out: stopsText(out), back: stopsText(back).toLocaleLowerCase(dateLocale()) });
    } else if (out != null) {
        stops = stopsText(out);
    }
    return [airline, stops].filter(Boolean).join(' · ');
}

/*
 * Live flight / hotel prices for a trip (both edge-cached on our side).
 * Each resolves to the API result, or null on failure / nothing found.
 */
function getJson(url) {
    return fetch(url).then(r => (r.ok ? r.json() : null)).then(d => (d && !d.error ? d : null)).catch(() => null);
}

/* Main international airport per country (when the destination's own airport has no fares) */
const MAIN_HUB = {
    CN: 'PEK', US: 'JFK', RU: 'SVO', JP: 'NRT', BR: 'GRU', IN: 'DEL', AU: 'SYD', CA: 'YYZ', ID: 'CGK',
    MX: 'MEX', AR: 'EZE', CL: 'SCL', CO: 'BOG', PE: 'LIM', ZA: 'JNB', EG: 'CAI', NG: 'LOS', KE: 'NBO',
    MA: 'CMN', SA: 'RUH', IR: 'IKA', PK: 'KHI', TH: 'BKK', VN: 'SGN', PH: 'MNL', MY: 'KUL', KR: 'ICN',
    KZ: 'ALA', UZ: 'TAS', TR: 'IST', DE: 'FRA', FR: 'CDG', GB: 'LHR', IT: 'FCO', ES: 'MAD', GR: 'ATH',
    NO: 'OSL', SE: 'ARN', FI: 'HEL', PL: 'WAW', UA: 'KBP', NZ: 'AKL', DZ: 'ALG', ET: 'ADD', TZ: 'DAR'
};

/*
 * Bigger airports to price through if nobody has searched this route (small
 * regional airports): the 2 nearest large airports in the destination
 * country (100+ km away), then the country's main hub.
 */
function viaHubs(dest) {
    const out = [];
    if (dest.l === 1) return out;                  // big airports have their own fares
    if (typeof allCities !== 'undefined') {
        allCities.filter(c => c.cc === dest.cc && c.l === 1 && c.a[0] !== dest.a[0])
            .map(c => ({ code: c.a[0], km: distanceKm(c, dest) }))
            .filter(c => c.km >= 100)
            .sort((a, b) => a.km - b.km)
            .slice(0, 2).forEach(c => out.push(c.code));
    }
    const main = MAIN_HUB[dest.cc];
    if (main && main !== dest.a[0] && !out.includes(main)) out.push(main);
    return out.slice(0, 3);
}

/* Position of an airport we know (for the hub -> destination leg) */
function airportPos(code) {
    const c = typeof allCities !== 'undefined' && allCities.find(x => x.a[0] === code);
    return c ? { lat: c.al[0], lon: c.al[1] } : null;
}

function fetchFlights(trip) {
    // Hubs near a small destination airport, then near a small origin airport
    const via = viaHubs(trip.destination).join(','), viaFrom = viaHubs(trip.origin).join(',');
    return getJson(`/api/flights?origin=${trip.origin.a[0]}&destination=${trip.destination.a[0]}` +
                   `&depart=${trip.start}&return=${trip.end}${via ? `&via=${via}` : ''}` +
                   `${viaFrom ? `&viaFrom=${viaFrom}` : ''}&v=9`);
}

function fetchHotels(trip) {
    return getJson(`/api/hotels?lat=${trip.destination.lat}&lon=${trip.destination.lon}` +
                   `&checkin=${trip.start}&checkout=${trip.end}&adults=${Math.min(2, trip.travelers)}&travelers=${trip.travelers}` +
                   `&city=${encodeURIComponent(trip.destination.n.replace(/ \(.*\)$/, ''))}` +
                   `&country=${encodeURIComponent(trip.destination.c)}&v=10`);
}

/* ------------------------------------------------------------- Currency -- */

let displayCurrency = 'USD';
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', TRY: '₺' };

/** "1 USD = 49.43 TRY · rates of 10 Oct 2026" for the current currency. */
function fxNoteText() {
    if (!priceData || displayCurrency === 'USD') return '';
    const rate = priceData.fx[displayCurrency];
    let when = '';
    if (priceData.fxDate) {
        const [y, m, d] = priceData.fxDate.split('-').map(Number);
        when = t(' · rates of {date}', { date: new Date(y, m - 1, d)
            .toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' }) });
    }
    return `1 USD = ${rate.toLocaleString('en', { maximumFractionDigits: 4 })} ${displayCurrency}${when}`;
}

function money(usd) {
    const rate = (priceData && priceData.fx[displayCurrency]) || 1;
    const value = usd * rate;
    const rounded = value >= 100 ? Math.round(value / 5) * 5 : Math.round(value);
    return CURRENCY_SYMBOLS[displayCurrency] + rounded.toLocaleString('en');
}
