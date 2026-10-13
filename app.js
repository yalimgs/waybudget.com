// ============================================================================
// Module: app.js
// Purpose: Form wiring, date rules, traveler rules, validation and summary.
// ============================================================================

const MIN_TRAVELERS = 1;
const MAX_TRAVELERS = 20;

const els = {};
let autocomplete = {};

document.addEventListener('DOMContentLoaded', () => {
    ['tripForm', 'startDate', 'endDate', 'passengers', 'tripLine',
     'formError', 'swapBtn', 'year'].forEach(id => { els[id] = document.getElementById(id); });

    applyStaticText();
    document.getElementById('langBtn').addEventListener('click', () => setLanguage(LANG === 'tr' ? 'en' : 'tr'));
    document.addEventListener('lang:change', () => {
        updateDateDisplays();
        if (!els.formError.hidden && els.formError.dataset.key) refreshErrors();
        renderBudget();
    });

    autocomplete.origin = setupAutocomplete('origin');
    autocomplete.destination = setupAutocomplete('destination');

    els.year.textContent = new Date().getFullYear();
    els.startDate.min = toISODate(new Date());
    updateMinEndDate();

    els.startDate.addEventListener('change', () => { updateMinEndDate(); updateRouteSummary(); });
    els.endDate.addEventListener('change', updateRouteSummary);
    els.swapBtn.addEventListener('click', swapCities);
    els.tripForm.addEventListener('submit', submitTrip);
    document.addEventListener('trip:change', updateRouteSummary);

    // Our own range calendar (departure, then return) on every device
    DatePicker.setup(els.startDate, els.endDate);
    updateDateDisplays();

    setupTravelersInput();
    setupBudgetControls();
    updateRouteSummary();
});

/* ---------------------------------------------------------------- Dates -- */

/**
 * Formats a Date as YYYY-MM-DD in the user's LOCAL time zone.
 * (toISOString() uses UTC, which shows the wrong day around midnight.)
 */
function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Adds days to a YYYY-MM-DD string and returns a new YYYY-MM-DD string. */
function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return toISODate(new Date(y, m - 1, d + days));
}

/** Whole nights between two YYYY-MM-DD strings (DST-safe). */
function nightsBetween(startIso, endIso) {
    const toUtc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((toUtc(endIso) - toUtc(startIso)) / 86400000);
}

/** Human-friendly date, e.g. "3 April 2026". */
function formatDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Keeps the return date at least one day after departure.
 */
function updateMinEndDate() {
    const startVal = els.startDate.value;
    els.endDate.min = addDays(startVal || els.startDate.min, 1);

    if (els.endDate.value && els.endDate.value < els.endDate.min) {
        els.endDate.value = '';
    }
}

/* ------------------------------------------------------------ Travelers -- */

/**
 * Travelers: digits only, 1–20, freely editable (can be cleared while typing),
 * falls back to 1 when left empty. Covers typing, pasting and the numpad.
 */
function setupTravelersInput() {
    const input = els.passengers;

    input.addEventListener('input', () => {
        const digits = input.value.replace(/\D/g, '').slice(0, 2);
        if (digits !== input.value) input.value = digits;
        if (digits && Number(digits) > MAX_TRAVELERS) input.value = String(MAX_TRAVELERS);
        updateRouteSummary();
    });

    input.addEventListener('blur', () => {
        input.value = String(getTravelers());
        updateRouteSummary();
    });

    document.querySelectorAll('.step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            input.value = String(clampTravelers(getTravelers() + Number(btn.dataset.step)));
            updateRouteSummary();
        });
    });
}

function clampTravelers(n) {
    return Math.min(MAX_TRAVELERS, Math.max(MIN_TRAVELERS, n));
}

function getTravelers() {
    const n = parseInt(els.passengers.value, 10);
    return Number.isNaN(n) ? MIN_TRAVELERS : clampTravelers(n);
}

/* ---------------------------------------------------------------- Route -- */

function swapCities() {
    const { origin, destination } = tripData;
    const originText = autocomplete.origin.input.value;
    const destText = autocomplete.destination.input.value;

    tripData.origin = destination;
    tripData.destination = origin;
    autocomplete.origin.input.value = destText;
    autocomplete.destination.input.value = originText;
    updateRouteSummary();
}

/* -------------------------------------------------------------- Summary -- */

/**
 * Renders the live trip summary card below the form.
 */
function updateRouteSummary() {
    invalidateBudget();
    updateDateDisplays();
    refreshErrors();
}

/* Shows the chosen dates as "3 April 2026" (the native field follows the browser locale) */
function updateDateDisplays() {
    document.querySelectorAll('.date-display').forEach(span => {
        const value = document.getElementById(span.dataset.for).value;
        span.textContent = value ? formatDate(value) : t('Select date');
        span.classList.toggle('empty', !value);
    });
    // Nights box between the dates and travelers
    const start = els.startDate.value, end = els.endDate.value;
    const n = start && end ? nightsBetween(start, end) : 0;
    document.getElementById('nightsBox').classList.toggle('empty', n < 1);
    document.getElementById('nightsNum').textContent = n >= 1 ? n : '–';
    document.getElementById('nightsWord').textContent = t(n === 1 ? 'night' : 'nights');
}

/* One-line trip summary shown under the budget title */
function tripLineText(trip) {
    const nights = trip.nights;
    return `${trip.origin.n} → ${trip.destination.n} · ${formatDate(trip.start)} – ${formatDate(trip.end)} · ` +
           `${tn(nights, '{n} night', '{n} nights')} · ${tn(trip.travelers, '{n} traveler', '{n} travelers')}`;
}

/* ----------------------------------------------------------- Submission -- */

const MAX_NIGHTS = 60;   // hotel rates are not available for longer stays

function showError(message, fieldIds = [], vars = {}, focus = true) {
    els.formError.dataset.key = message;          // English key, re-translated on language change
    els.formError.dataset.vars = JSON.stringify(vars);
    els.formError.textContent = t(message, vars);
    els.formError.hidden = false;
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
    fieldIds.forEach(id => document.getElementById(id).classList.add('invalid'));
    if (focus && fieldIds[0]) {
        const el = document.getElementById(fieldIds[0]);
        (el.closest('.date-input') || el).focus();   // date fields: focus the clickable box
    }
}

function clearErrors() {
    els.formError.hidden = true;
    els.formError.dataset.key = '';
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
}

/*
 * Checks the form. Returns null when it is fine, otherwise the first problem:
 * { message (English key), fields (ids to mark red), vars }.
 */
function validateTrip() {
    const { origin, destination } = tripData;
    const start = els.startDate.value;
    const end = els.endDate.value;

    // Missing fields: say exactly which ones
    const labels = { origin: 'From', destination: 'To', startDate: 'Departure date', endDate: 'Return date' };
    const missing = [];
    if (!origin) missing.push('origin');
    if (!destination) missing.push('destination');
    if (!start) missing.push('startDate');
    if (!end) missing.push('endDate');
    if (missing.length) {
        const typedNotPicked = ['origin', 'destination'].filter(k =>
            missing.includes(k) && autocomplete[k].input.value.trim());
        if (typedNotPicked.length) {
            return { message: 'Please pick your cities from the suggestion list.', fields: typedNotPicked };
        }
        return { message: 'Please add: {fields}.', fields: missing,
                 vars: { fields: missing.map(k => t(labels[k])).join(', ') } };
    }

    const sameCity = origin === destination ||
        (origin.n === destination.n && origin.cc === destination.cc) ||
        (origin.a && destination.a && origin.a[0] === destination.a[0]);
    if (sameCity) {
        return { message: 'Origin and destination cannot be the same. Please choose different cities.',
                 fields: ['destination'] };
    }

    // "today" is checked now, not when the page was opened (page left open overnight)
    if (start < toISODate(new Date())) {
        return { message: 'Departure date cannot be in the past.', fields: ['startDate'] };
    }
    if (end <= start) {
        return { message: 'Return date must be at least one day after departure.', fields: ['endDate'] };
    }
    if (nightsBetween(start, end) > MAX_NIGHTS) {
        return { message: 'Trips can be up to {n} nights. Please choose an earlier return date.',
                 fields: ['endDate'], vars: { n: MAX_NIGHTS } };
    }
    return null;
}

/*
 * While an error is shown, re-check after every change: the message updates
 * to the next remaining problem, and disappears once everything is fixed.
 */
function refreshErrors() {
    if (els.formError.hidden) return;
    const problem = validateTrip();
    if (!problem) clearErrors();
    else showError(problem.message, problem.fields, problem.vars, false);
}

/**
 * Validates the form and, when everything is fine, shows the budget.
 */
function submitTrip(event) {
    event.preventDefault();
    clearErrors();

    const problem = validateTrip();
    if (problem) {
        showError(problem.message, problem.fields, problem.vars);
        return;
    }
    const { origin, destination } = tripData;
    const start = els.startDate.value;
    const end = els.endDate.value;

    els.passengers.value = String(getTravelers());
    updateRouteSummary();

    currentTrip = { origin, destination, start, end,
                    nights: nightsBetween(start, end), travelers: getTravelers() };
    liveData = {};
    loadLivePrices();
    renderBudget();
    document.getElementById('budgetResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* --------------------------------------------------------------- Budget -- */

let currentTrip = null;
let liveData = {};   // { flights, hotel } results + loadingFlights / loadingHotel flags

/*
 * Fetches live flight / hotel prices that are needed and not loaded yet.
 * Items set to "None" are skipped (no API request) until chosen again.
 */
function loadLivePrices() {
    const trip = currentTrip;
    if (!trip) return;
    const parts = [
        ['flights', 'loadingFlights', fetchFlights],
        ['hotel', 'loadingHotel', fetchHotels]
    ];
    for (const [key, flag, fetcher] of parts) {
        if (choices[key] === 'none' || key in liveData || liveData[flag]) continue;
        liveData[flag] = true;
        fetcher(trip).then(result => {
            if (currentTrip !== trip) return;      // inputs changed meanwhile
            liveData[key] = result;
            liveData[flag] = false;
            renderBudget();
        });
    }
}
let choices = { ...BUDGET_MODEL.presets.standard };

const ITEM_ICONS = { flights: '✈️', hotel: '🏨', food: '🍽️', transfer: '🚕', local: '🚇' };
const KIND_LABELS = { live: 'Live', estimate: 'Estimate', rough: 'Approx.', loading: 'Working…', none: '' };

async function renderBudget() {
    if (!currentTrip) return;
    await pricesReady;

    const result = calculateBudget(currentTrip, choices, liveData);
    const list = document.getElementById('budgetItems');
    list.innerHTML = '';

    result.items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'budget-item' + (item.kind === 'none' ? ' excluded' : '');

        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = ITEM_ICONS[item.key] || '•';

        const body = document.createElement('div');
        body.className = 'item-body';
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = t(item.label) + ' ';
        const badge = document.createElement('span');
        badge.className = `badge badge-${item.kind}`;
        badge.textContent = KIND_LABELS[item.kind] ? t(KIND_LABELS[item.kind]) : '';
        badge.title = item.source || '';
        title.appendChild(badge);
        const detail = document.createElement('div');
        detail.className = 'item-detail';
        detail.textContent = item.detail;
        body.append(title, detail);
        if (item.link && item.kind !== 'none') {
            const link = document.createElement('a');
            link.className = 'item-link';
            link.href = item.link;
            link.target = '_blank';
            link.rel = 'sponsored noopener';
            link.textContent = t(item.linkLabel || 'See flights') + ' →';
            body.appendChild(link);
        }

        // Per-item choice (e.g. cheapest flight + 4–5★ hotel)
        const options = BUDGET_MODEL.options[item.key];
        if (options) {
            const group = document.createElement('div');
            group.className = 'item-choices';
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', t('{label} option', { label: t(item.label) }));
            options.forEach(([value, label]) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = t(label);
                btn.setAttribute('aria-pressed', String(value === choices[item.key]));
                btn.addEventListener('click', () => {
                    if (choices[item.key] === value) return;
                    choices[item.key] = value;
                    syncPresetTabs();
                    loadLivePrices();
                    renderBudget();
                });
                group.appendChild(btn);
            });
            li._choices = group;
        }

        const amount = document.createElement('span');
        amount.className = 'item-amount';
        amount.textContent = money(item.amount);

        li.append(icon, body, amount);
        if (li._choices) li.appendChild(li._choices);   // own row under the text
        list.appendChild(li);
    });

    els.tripLine.textContent = tripLineText(currentTrip);
    document.getElementById('fxNote').textContent = fxNoteText();
    document.getElementById('budgetTotal').textContent = money(result.total);
    document.getElementById('budgetPerPerson').textContent =
        currentTrip.travelers > 1 ? t('{p} per person', { p: money(result.perPerson) }) : '';
    document.getElementById('budgetResult').hidden = false;
}

function setupBudgetControls() {
    document.querySelectorAll('.tier-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            choices = { ...BUDGET_MODEL.presets[btn.dataset.tier] };
            syncPresetTabs();
            loadLivePrices();
            renderBudget();
        });
    });
    document.addEventListener('fx:update', renderBudget);
    document.getElementById('currency').addEventListener('change', e => {
        displayCurrency = e.target.value;
        renderBudget();
    });
}

/* Highlights the preset tab matching the current choices (none = custom mix) */
function syncPresetTabs() {
    document.querySelectorAll('.tier-tabs button').forEach(btn => {
        const preset = BUDGET_MODEL.presets[btn.dataset.tier];
        const match = Object.keys(preset).every(k => preset[k] === choices[k]);
        btn.setAttribute('aria-pressed', String(match));
    });
}

/* Inputs changed after a result was shown: hide the stale result */
function invalidateBudget() {
    if (!currentTrip) return;
    currentTrip = null;
    liveData = {};
    document.getElementById('budgetResult').hidden = true;
}

/*
 * Every link to another site opens in a new tab, so the budget stays open.
 * Runs before other click handlers (capture phase), using the link's current
 * href, which already includes affiliate tracking added on page load.
 */
document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    let url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.open(url.href, '_blank', 'noopener');
}, true);

