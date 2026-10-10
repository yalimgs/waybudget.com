// ============================================================================
// Module: app.js
// Purpose: Form wiring, date rules, traveler rules, validation and summary.
// ============================================================================

const MIN_TRAVELERS = 1;
const MAX_TRAVELERS = 20;

const els = {};
let autocomplete = {};

document.addEventListener('DOMContentLoaded', () => {
    ['tripForm', 'startDate', 'endDate', 'passengers', 'summaryDisplay',
     'formError', 'swapBtn', 'year'].forEach(id => { els[id] = document.getElementById(id); });

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

/** Human-friendly date, e.g. "Sat, 10 Oct 2026". */
function formatDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
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
    const { origin, destination } = tripData;
    const start = els.startDate.value;
    const end = els.endDate.value;
    const travelers = getTravelers();
    const box = els.summaryDisplay;

    if (!origin && !destination && !start && !end) {
        box.hidden = true;
        return;
    }

    const rows = [];
    if (origin || destination) {
        const from = origin ? `${origin.n} (${origin.a[0]})` : '—';
        const to = destination ? `${destination.n} (${destination.a[0]})` : '—';
        rows.push(['Route', `${from} → ${to}`]);
    }
    if (start && end) {
        const nights = nightsBetween(start, end);
        rows.push(['Dates', `${formatDate(start)} – ${formatDate(end)}`]);
        rows.push(['Duration', `${nights} night${nights === 1 ? '' : 's'}, ${nights + 1} days`]);
    } else if (start) {
        rows.push(['Departure', formatDate(start)]);
    }
    rows.push(['Travelers', `${travelers} ${travelers === 1 ? 'person' : 'people'}`]);

    box.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = 'Your trip';
    const dl = document.createElement('dl');
    rows.forEach(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        dl.append(dt, dd);
    });
    box.append(title, dl);
    box.hidden = false;
}

/* ----------------------------------------------------------- Submission -- */

function showError(message, fieldIds = []) {
    els.formError.textContent = message;
    els.formError.hidden = false;
    fieldIds.forEach(id => document.getElementById(id).classList.add('invalid'));
    if (fieldIds[0]) document.getElementById(fieldIds[0]).focus();
}

function clearErrors() {
    els.formError.hidden = true;
    document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
}

/**
 * Validates the form and, when everything is fine, shows the next step.
 */
function submitTrip(event) {
    event.preventDefault();
    clearErrors();

    const { origin, destination } = tripData;
    const start = els.startDate.value;
    const end = els.endDate.value;

    const missing = [];
    if (!origin) missing.push('origin');
    if (!destination) missing.push('destination');
    if (!start) missing.push('startDate');
    if (!end) missing.push('endDate');
    if (missing.length) {
        const cityTyped = (!origin && autocomplete.origin.input.value.trim()) ||
                          (!destination && autocomplete.destination.input.value.trim());
        showError(cityTyped
            ? 'Please pick your cities from the suggestion list.'
            : 'Please fill in origin, destination and both dates.', missing);
        return;
    }

    if (origin === destination || (origin.n === destination.n && origin.cc === destination.cc)) {
        showError('Origin and destination cannot be the same. Please choose different cities.',
                  ['destination']);
        return;
    }

    if (start < els.startDate.min) {
        showError('Departure date cannot be in the past.', ['startDate']);
        return;
    }
    if (end <= start) {
        showError('Return date must be at least one day after departure.', ['endDate']);
        return;
    }

    els.passengers.value = String(getTravelers());
    updateRouteSummary();

    currentTrip = { origin, destination, nights: nightsBetween(start, end), travelers: getTravelers() };
    renderBudget();
    document.getElementById('budgetResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* --------------------------------------------------------------- Budget -- */

let currentTrip = null;
let choices = { ...BUDGET_MODEL.presets.standard };

const ITEM_ICONS = { flights: '✈️', hotel: '🏨', food: '🍽️', transfer: '🚕', local: '🚇' };
const KIND_LABELS = { live: 'Live', estimate: 'Estimate', rough: 'Rough' };

async function renderBudget() {
    if (!currentTrip) return;
    await pricesReady;

    const result = calculateBudget(currentTrip, choices);
    const list = document.getElementById('budgetItems');
    list.innerHTML = '';

    result.items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'budget-item';

        const icon = document.createElement('span');
        icon.className = 'item-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = ITEM_ICONS[item.key] || '•';

        const body = document.createElement('div');
        body.className = 'item-body';
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = item.label + ' ';
        const badge = document.createElement('span');
        badge.className = `badge badge-${item.kind}`;
        badge.textContent = KIND_LABELS[item.kind];
        badge.title = item.source;
        title.appendChild(badge);
        const detail = document.createElement('div');
        detail.className = 'item-detail';
        detail.textContent = item.detail;
        body.append(title, detail);

        // Per-item choice (e.g. budget flight + upscale hotel)
        const options = BUDGET_MODEL.options[item.key];
        if (options) {
            const select = document.createElement('select');
            select.className = 'item-choice';
            select.setAttribute('aria-label', `${item.label} option`);
            options.forEach(([value, label]) => select.add(new Option(label, value, false, value === choices[item.key])));
            select.addEventListener('change', () => {
                choices[item.key] = select.value;
                syncPresetTabs();
                renderBudget();
            });
            body.appendChild(select);
        }

        const amount = document.createElement('span');
        amount.className = 'item-amount';
        amount.textContent = money(item.amount);

        li.append(icon, body, amount);
        list.appendChild(li);
    });

    document.getElementById('fxNote').textContent = fxNoteText();
    document.getElementById('budgetTotal').textContent = money(result.total);
    document.getElementById('budgetPerPerson').textContent =
        currentTrip.travelers > 1 ? `${money(result.perPerson)} per person` : '';
    document.getElementById('budgetResult').hidden = false;
}

function setupBudgetControls() {
    document.querySelectorAll('.tier-tabs button').forEach(btn => {
        btn.addEventListener('click', () => {
            choices = { ...BUDGET_MODEL.presets[btn.dataset.tier] };
            syncPresetTabs();
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
    document.getElementById('budgetResult').hidden = true;
}
