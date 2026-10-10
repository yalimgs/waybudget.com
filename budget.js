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

    // Hotel: price per room per night (US base), 2 travelers per room
    hotelNight:   { budget: 90, standard: 170, luxury: 380 },
    hotelExp: 0.7,
    peoplePerRoom: 2,
    bigCityHotelFactor: 1.2,          // cities with a major airport

    // Food: per person per day (US base): breakfast, lunch, dinner, drinks/snacks
    foodDay:      { budget: 35, standard: 70, luxury: 130 },
    foodExp: 0.75,
    bigCityFoodFactor: 1.1,

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
function estimateFlightPerPerson(km, tier) {
    const f = BUDGET_MODEL.flight;
    const fare = km <= f.longFrom
        ? f.base + km * f.shortPerKm
        : f.base + f.longFrom * f.shortPerKm + (km - f.longFrom) * f.longPerKm;
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
    const level = priceLevel(destination.cc);
    const big = destination.l === 1;
    const rooms = Math.ceil(travelers / M.peoplePerRoom);
    const cars = Math.ceil(travelers / M.peoplePerCar);
    const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
    const items = [];

    // ---- Flights
    const km = distanceKm(origin, destination);
    const route = `Round trip ${origin.a[0]} ⇄ ${destination.a[0]}`;
    const fl = live.flights && live.flights.found ? live.flights : null;
    if (fl) {
        const seen = fl.match === 'month' ? 'Fares seen recently for these months' : 'Fares seen recently for these dates';
        let perPerson, kind = 'live', info, source = `${seen} (Aviasales)`;
        if (choices.flights === 'economy') {
            perPerson = fl.economy.price;
            info = describeFare(fl.economy);
            source = `Lowest of ${fl.fares} ${source.toLowerCase()}`;
        } else if (choices.flights === 'standard') {
            if (fl.standard && !fl.standard.derived) {
                perPerson = fl.standard.price;
                info = describeFare(fl.standard);
                source = `Typical (median) of ${fl.fares} ${source.toLowerCase()}`;
            } else if (fl.standard) {
                perPerson = fl.standard.price;
                kind = 'estimate'; info = 'Typical fare';
                source = 'Lowest live fare + typical markup seen on this route';
            } else {
                perPerson = fl.economy.price * M.standardFallbackFactor;
                kind = 'estimate'; info = 'Typical fare';
                source = 'Too few fares seen; estimated from the lowest live fare';
            }
        } else if (fl.business) {
            perPerson = fl.business.price;
            info = 'Business class';
            source = 'Lowest business-class fare seen recently (Aviasales)';
        } else {
            const [, factor] = M.businessFactor.find(([maxKm]) => km <= maxKm);
            const std = fl.standard ? fl.standard.price : fl.economy.price * M.standardFallbackFactor;
            perPerson = std * factor;
            kind = 'estimate'; info = 'Business class';
            source = 'Estimated from live economy fares';
        }
        items.push({
            key: 'flights', label: 'Flights',
            detail: `${route} · ${info} · ${travelers} × ${money(perPerson)}`,
            amount: perPerson * travelers, kind, source
        });
    } else {
        const perPerson = estimateFlightPerPerson(km, choices.flights);
        items.push({
            key: 'flights', label: 'Flights',
            detail: `${route} · ${Math.round(km).toLocaleString('en')} km · ${travelers} × ${money(perPerson)}`,
            amount: perPerson * travelers, kind: live.loadingFlights ? 'loading' : 'rough',
            source: live.loadingFlights ? 'Loading live fares' : 'Distance-based estimate (no live fare found)'
        });
    }

    // ---- Accommodation
    const ho = live.hotel && live.hotel.found ? live.hotel[choices.hotel] : null;
    if (ho) {
        const ex = ho.example ? ` · e.g. ${ho.example.name}` : '';
        items.push({
            key: 'hotel', label: 'Hotel',
            detail: `${plural(rooms, 'room')} × ${plural(nights, 'night')} · ${money(ho.perNight)}/night${ex}`,
            amount: ho.perNight * rooms * nights, kind: 'live',
            source: `Live rates for your dates, ${live.hotel.count} hotels compared`
        });
    } else {
        const perNight = M.hotelNight[choices.hotel] * level ** M.hotelExp * (big ? M.bigCityHotelFactor : 1);
        items.push({
            key: 'hotel', label: 'Hotel',
            detail: `${plural(rooms, 'room')} × ${plural(nights, 'night')} · ~${money(perNight)}/night`,
            amount: perNight * rooms * nights, kind: live.loadingHotel ? 'loading' : 'rough',
            source: live.loadingHotel ? 'Loading live hotel rates' : 'Price-level estimate (no live rates found)'
        });
    }

    // ---- Food
    const foodDay = M.foodDay[choices.food] * level ** M.foodExp * (big ? M.bigCityFoodFactor : 1);
    items.push({
        key: 'food', label: 'Food & drinks',
        detail: `${travelers} × ${days} days · ~${money(foodDay)} per person/day`,
        amount: foodDay * travelers * days, kind: 'estimate',
        source: 'Based on the destination country\'s price level'
    });

    // ---- Airport transfers (both ways)
    const roadKm = Math.max(8, destination.d || 20) * M.roadFactor;
    const taxiRide = (M.taxiFlag + M.taxiPerKm * roadKm) * level ** M.transitExp;
    let transfer;
    if (choices.transfer === 'transit') {
        const ride = M.transitTrip * level ** M.transitExp;
        transfer = { amount: ride * travelers * 2,
            detail: `Both ways · ${travelers} × ~${money(ride)} per ride` };
    } else {
        const ride = taxiRide * (choices.transfer === 'private' ? M.privateFactor : 1);
        transfer = { amount: ride * cars * 2,
            detail: `Both ways · ${plural(cars, 'car')} · ~${Math.round(roadKm)} km · ~${money(ride)} per ride` };
    }
    items.push({
        key: 'transfer', label: 'Airport transfers', ...transfer, kind: 'estimate',
        source: `${destination.a[0]} is ~${Math.round(destination.d || 20)} km from the city centre`
    });

    // ---- Getting around the city during the stay
    const localDay = M.localDay[choices.local] * level ** M.localExp;
    items.push({
        key: 'local', label: 'Local transport',
        detail: `${travelers} × ${days} days · ~${money(localDay)} per person/day`,
        amount: localDay * travelers * days, kind: 'estimate',
        source: 'Metro, bus, tram and short rides while sightseeing'
    });

    // Items the traveller removed ("None"): shown, but not counted
    for (const item of items) {
        if (choices[item.key] === 'none') {
            Object.assign(item, { amount: 0, detail: 'Not included', kind: 'none', source: '' });
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

function describeFare(f) {
    const airline = AIRLINES[f.airline] || f.airline || '';
    const stops = Math.max(f.transfers || 0, f.returnTransfers || 0);
    const stopText = stops === 0 ? 'Direct' : `${stops} stop${stops > 1 ? 's' : ''}`;
    return [airline, stopText].filter(Boolean).join(' · ');
}

/*
 * Live flight / hotel prices for a trip (both edge-cached on our side).
 * Each resolves to the API result, or null on failure / nothing found.
 */
function getJson(url) {
    return fetch(url).then(r => (r.ok ? r.json() : null)).then(d => (d && !d.error ? d : null)).catch(() => null);
}

function fetchFlights(trip) {
    return getJson(`/api/flights?origin=${trip.origin.a[0]}&destination=${trip.destination.a[0]}` +
                   `&depart=${trip.start}&return=${trip.end}&v=6`);
}

function fetchHotels(trip) {
    return getJson(`/api/hotels?lat=${trip.destination.lat}&lon=${trip.destination.lon}` +
                   `&checkin=${trip.start}&checkout=${trip.end}&adults=${Math.min(2, trip.travelers)}&v=3`);
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
        when = ' · rates of ' + new Date(y, m - 1, d)
            .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return `1 USD = ${rate.toLocaleString('en', { maximumFractionDigits: 4 })} ${displayCurrency}${when}`;
}

function money(usd) {
    const rate = (priceData && priceData.fx[displayCurrency]) || 1;
    const value = usd * rate;
    const rounded = value >= 100 ? Math.round(value / 5) * 5 : Math.round(value);
    return CURRENCY_SYMBOLS[displayCurrency] + rounded.toLocaleString('en');
}
