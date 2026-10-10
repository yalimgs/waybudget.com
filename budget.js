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
    // Choices offered per line item (first = cheapest). Labels are shown in the UI.
    options: {
        flights:  [['budget', 'Cheapest'], ['standard', 'Standard'], ['comfort', 'Flexible']],
        hotel:    [['budget', 'Hostel / 2★'], ['standard', '3★'], ['comfort', '4–5★']],
        food:     [['budget', 'Street food'], ['standard', 'Casual'], ['comfort', 'Fine dining']],
        transfer: [['transit', 'Train / bus'], ['taxi', 'Taxi'], ['private', 'Private']],
        local:    [['public', 'Public'], ['mixed', 'Mixed'], ['taxi', 'Taxi']]
    },
    // Quick presets for the Budget / Standard / Comfort tabs
    presets: {
        budget:   { flights: 'budget', hotel: 'budget', food: 'budget', transfer: 'transit', local: 'public' },
        standard: { flights: 'standard', hotel: 'standard', food: 'standard', transfer: 'taxi', local: 'mixed' },
        comfort:  { flights: 'comfort', hotel: 'comfort', food: 'comfort', transfer: 'private', local: 'taxi' }
    },

    // Hotel: price per room per night (US base), 2 travelers per room
    hotelNight:   { budget: 90, standard: 170, comfort: 300 },
    hotelExp: 0.7,
    peoplePerRoom: 2,
    bigCityHotelFactor: 1.2,          // cities with a major airport

    // Food: per person per day (US base): breakfast, lunch, dinner, drinks/snacks
    foodDay:      { budget: 35, standard: 70, comfort: 130 },
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
    flightTierFactor: { budget: 0.85, standard: 1, comfort: 1.35 },

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
    return fare * BUDGET_MODEL.flightTierFactor[tier];
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
    if (live.flights) {
        items.push({
            key: 'flights', label: 'Flights',
            detail: `Round trip ${origin.a[0]} ⇄ ${destination.a[0]} · ${travelers} × ${money(live.flights.perPerson)}`,
            amount: live.flights.perPerson * travelers, kind: 'live', source: live.flights.source
        });
    } else {
        const perPerson = estimateFlightPerPerson(km, choices.flights);
        items.push({
            key: 'flights', label: 'Flights',
            detail: `Round trip ${origin.a[0]} ⇄ ${destination.a[0]} · ${Math.round(km).toLocaleString('en')} km · ${travelers} × ${money(perPerson)}`,
            amount: perPerson * travelers, kind: 'rough',
            source: 'Distance-based estimate until live fares are connected'
        });
    }

    // ---- Accommodation
    if (live.hotel) {
        items.push({
            key: 'hotel', label: 'Accommodation',
            detail: `${plural(rooms, 'room')} × ${plural(nights, 'night')} · ${money(live.hotel.perNight)}/night`,
            amount: live.hotel.perNight * rooms * nights, kind: 'live', source: live.hotel.source
        });
    } else {
        const perNight = M.hotelNight[choices.hotel] * level ** M.hotelExp * (big ? M.bigCityHotelFactor : 1);
        items.push({
            key: 'hotel', label: 'Accommodation',
            detail: `${plural(rooms, 'room')} × ${plural(nights, 'night')} · ~${money(perNight)}/night`,
            amount: perNight * rooms * nights, kind: 'rough',
            source: 'Price-level estimate until live hotel rates are connected'
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
        key: 'transfer', label: 'Airport ⇄ hotel', ...transfer, kind: 'estimate',
        source: `${destination.a[0]} is ~${Math.round(destination.d || 20)} km from the city centre`
    });

    // ---- Getting around the city during the stay
    const localDay = M.localDay[choices.local] * level ** M.localExp;
    items.push({
        key: 'local', label: 'Getting around the city',
        detail: `${travelers} × ${days} days · ~${money(localDay)} per person/day`,
        amount: localDay * travelers * days, kind: 'estimate',
        source: 'Metro, bus, tram and short rides while sightseeing'
    });

    const total = items.reduce((sum, item) => sum + item.amount, 0);
    return { items, total, perPerson: total / travelers };
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
            .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return `1 USD = ${rate.toLocaleString('en', { maximumFractionDigits: 4 })} ${displayCurrency}${when}`;
}

function money(usd) {
    const rate = (priceData && priceData.fx[displayCurrency]) || 1;
    const value = usd * rate;
    const rounded = value >= 100 ? Math.round(value / 5) * 5 : Math.round(value);
    return CURRENCY_SYMBOLS[displayCurrency] + rounded.toLocaleString('en');
}
