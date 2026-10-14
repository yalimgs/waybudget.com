// ============================================================================
// Module: datepicker.js
// Purpose: One calendar for departure + return (Booking-style range picker).
// Why: phone browsers only open their own date picker on a direct tap, so the
// return calendar could not open by itself after picking departure (and iOS
// ignores min dates). This picker works the same on every device.
//
// The two <input type="date"> fields stay in the form as the source of truth
// (value + 'change' events), so the rest of the app is unchanged; this module
// only replaces how dates are picked.
//   First tap  = departure, second tap = return, then it closes.
//   Phone: bottom sheet with scrolling months. Desktop: two months side by side.
//   Keyboard: arrows, Page Up/Down (month), Home/End (week), Enter, Escape.
// ============================================================================

const DatePicker = (() => {
    const MONTHS_MOBILE = 13;          // this month + 12
    const MAX_DAYS_AHEAD = 365;        // fares/rates are not published further out
    const MOBILE = () => window.matchMedia('(max-width: 680px)').matches;

    let startInput, endInput, root, panel, monthsBox, summary, live;
    let state = { start: '', end: '', picking: 'start', view: null, hover: '' };
    let lastTrigger = null;
    let focusIso = '';

    /* ---------- date helpers (local time, YYYY-MM-DD) ---------- */
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
    const plusDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
    const today = () => iso(new Date());
    const maxDate = () => plusDays(today(), MAX_DAYS_AHEAD);
    const firstOfMonth = s => s.slice(0, 8) + '01';
    const addMonths = (s, n) => { const d = parse(firstOfMonth(s)); d.setMonth(d.getMonth() + n); return iso(d); };
    const nights = (a, b) => Math.round((Date.UTC(...b.split('-').map((v, i) => i === 1 ? v - 1 : +v)) -
                                         Date.UTC(...a.split('-').map((v, i) => i === 1 ? v - 1 : +v))) / 86400000);
    const fmt = (s, opts) => parse(s).toLocaleDateString(dateLocale(), opts);
    // "Fri, 16 Oct" / "Cum, 16 Eki" (same order in both languages)
    const shortDay = s => `${fmt(s, { weekday: 'short' }).replace('.', '')}, ${fmt(s, { day: 'numeric', month: 'short' })}`;

    /* ---------- build the (hidden) overlay once ---------- */
    function build() {
        root = document.createElement('div');
        root.className = 'dp-root';
        root.hidden = true;
        root.innerHTML = `
            <div class="dp-backdrop"></div>
            <div class="dp-panel" role="dialog" aria-modal="true">
                <div class="dp-head">
                    <div class="dp-summary" aria-live="polite"></div>
                    <button type="button" class="dp-close" aria-label="Close">&times;</button>
                </div>
                <div class="dp-nav">
                    <button type="button" class="dp-prev" aria-label="Previous month">&#8249;</button>
                    <button type="button" class="dp-next" aria-label="Next month">&#8250;</button>
                </div>
                <div class="dp-months"></div>
                <div class="dp-foot">
                    <button type="button" class="dp-clear"></button>
                    <button type="button" class="dp-done"></button>
                </div>
                <div class="sr-only dp-live" aria-live="polite"></div>
            </div>`;
        document.body.appendChild(root);
        panel = root.querySelector('.dp-panel');
        monthsBox = root.querySelector('.dp-months');
        summary = root.querySelector('.dp-summary');
        live = root.querySelector('.dp-live');

        // Closing any way keeps what is selected (Done, ×, outside, Esc)
        root.querySelector('.dp-backdrop').addEventListener('click', () => close(true));
        root.querySelector('.dp-close').addEventListener('click', () => close(true));
        root.querySelector('.dp-done').addEventListener('click', () => close(true));
        root.querySelector('.dp-clear').addEventListener('click', () => {
            state.start = ''; state.end = ''; state.picking = 'start'; render(); focusDay(state.view);
        });
        root.querySelector('.dp-prev').addEventListener('click', () => shiftView(-1));
        root.querySelector('.dp-next').addEventListener('click', () => shiftView(1));

        monthsBox.addEventListener('click', e => {
            const btn = e.target.closest('button[data-date]');
            if (btn && !btn.disabled) pick(btn.dataset.date);
        });
        monthsBox.addEventListener('mouseover', e => {
            const btn = e.target.closest('button[data-date]');
            const h = btn && !btn.disabled ? btn.dataset.date : '';
            if (state.picking === 'end' && state.start && h !== state.hover) { state.hover = h; paintRange(); }
        });
        panel.addEventListener('keydown', onKey);
        window.addEventListener('resize', () => { if (!root.hidden) { render(); position(); } });
        document.addEventListener('lang:change', () => { if (!root.hidden) render(); });
    }

    /* ---------- open / close ---------- */
    function open(which, trigger) {
        lastTrigger = trigger || null;
        state.start = startInput.value || '';
        state.end = endInput.value || '';
        state.hover = '';
        state.picking = which === 'end' && state.start ? 'end' : 'start';
        const anchor = state.picking === 'end' ? (state.end || state.start) : (state.start || today());
        state.view = firstOfMonth(anchor < today() ? today() : anchor);
        root.hidden = false;
        document.body.classList.add('dp-open');
        render();
        position();
        focusDay(state.picking === 'end' ? (state.end || plusDays(state.start, 1)) : (state.start || today()));
        // Desktop: make sure the whole calendar is on screen
        if (!MOBILE()) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        [startInput, endInput].forEach(i => i.closest('.date-input').setAttribute('aria-expanded', 'true'));
    }

    function close(apply) {
        if (root.hidden) return;
        if (apply) commit();
        root.hidden = true;
        document.body.classList.remove('dp-open');
        [startInput, endInput].forEach(i => i.closest('.date-input').setAttribute('aria-expanded', 'false'));
        if (lastTrigger) lastTrigger.focus({ preventScroll: true });
    }

    /* Write the chosen dates into the real inputs and notify the app */
    function commit() {
        if (state.start !== startInput.value) {
            startInput.value = state.start;
            startInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const end = state.end && state.start && state.end > state.start ? state.end : '';
        if (end !== endInput.value) {
            endInput.value = end;
            endInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /* ---------- picking ---------- */
    function pick(day) {
        if (state.picking === 'start' || !state.start || day <= state.start) {
            state.start = day;
            if (state.end && state.end <= day) state.end = '';
            state.end = '';
            state.picking = 'end';
            render();
            focusDay(plusDays(day, 1) <= maxDate() ? plusDays(day, 1) : day);
            announce(t('Departure') + ': ' + fmt(day, { weekday: 'long', day: 'numeric', month: 'long' }) +
                     '. ' + t('Now pick your return date'));
        } else {
            state.end = day;
            state.hover = '';
            render();
            announce(rangeText());
            // Stay open so the choice can be seen (and changed): tapping another
            // later day moves the return, an earlier one starts over; Done closes.
            const done = root.querySelector('.dp-done');
            done.classList.remove('dp-ready'); void done.offsetWidth; done.classList.add('dp-ready');
            done.focus({ preventScroll: true });
        }
    }

    function rangeText() {
        if (!state.start) return t('Pick your departure date');
        const a = fmt(state.start, { day: 'numeric', month: 'short' });
        if (!state.end) return `${a} → ${t('Pick your return date')}`;
        const b = fmt(state.end, { day: 'numeric', month: 'short' });
        return `${a} → ${b} · ${tn(nights(state.start, state.end), '{n} night', '{n} nights')}`;
    }

    function announce(text) { live.textContent = text; }

    /* ---------- rendering ---------- */
    function weekdayNames() {
        // Monday-first short names in the current language
        const base = new Date(2024, 0, 1);   // a Monday
        return Array.from({ length: 7 }, (_, i) =>
            new Date(2024, 0, 1 + i).toLocaleDateString(dateLocale(), { weekday: 'short' }).replace('.', ''));
    }

    function monthHtml(first) {
        const d = parse(first);
        const title = d.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
        const lead = (d.getDay() + 6) % 7;                    // Monday = 0
        const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const min = today(), max = maxDate();
        let cells = '';
        for (let i = 0; i < lead; i++) cells += '<span class="dp-blank" role="gridcell"></span>';
        for (let n = 1; n <= days; n++) {
            const day = `${first.slice(0, 8)}${pad(n)}`;
            const disabled = day < min || day > max;
            const label = fmt(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            cells += `<button type="button" role="gridcell" tabindex="-1" data-date="${day}"` +
                     `${disabled ? ' disabled aria-disabled="true"' : ''}` +
                     `${day === min ? ' aria-current="date"' : ''} aria-label="${label}">${n}</button>`;
        }
        const heads = weekdayNames().map(w => `<span class="dp-wd" aria-hidden="true">${w}</span>`).join('');
        return `<section class="dp-month" data-month="${first}">
                    <h3 class="dp-title">${title}</h3>
                    <div class="dp-grid" role="grid" aria-label="${title}">${heads}${cells}</div>
                </section>`;
    }

    function render() {
        const mobile = MOBILE();
        panel.classList.toggle('dp-mobile', mobile);
        const minView = firstOfMonth(today()), maxView = firstOfMonth(maxDate());
        if (state.view < minView) state.view = minView;
        if (state.view > maxView) state.view = maxView;

        let html = '';
        if (mobile) {
            for (let i = 0; i < MONTHS_MOBILE; i++) html += monthHtml(addMonths(minView, i));
        } else {
            const second = addMonths(state.view, 1);
            html = monthHtml(state.view) + (second <= maxView ? monthHtml(second) : '');
        }
        const keepScroll = monthsBox.scrollTop;
        monthsBox.innerHTML = html;
        if (mobile) monthsBox.scrollTop = keepScroll;

        root.querySelector('.dp-prev').disabled = state.view <= minView;
        root.querySelector('.dp-next').disabled = addMonths(state.view, 1) >= maxView;
        root.querySelector('.dp-prev').setAttribute('aria-label', t('Previous month'));
        root.querySelector('.dp-next').setAttribute('aria-label', t('Next month'));
        root.querySelector('.dp-close').setAttribute('aria-label', t('Close'));
        root.querySelector('.dp-clear').textContent = t('Clear');
        // "Done · 5 nights" once both dates are picked
        const doneBtn = root.querySelector('.dp-done');
        doneBtn.textContent = state.start && state.end
            ? `${t('Done')} · ${tn(nights(state.start, state.end), '{n} night', '{n} nights')}` : t('Done');
        if (!state.end) doneBtn.classList.remove('dp-ready');
        panel.setAttribute('aria-label', t('Choose your travel dates'));
        summary.innerHTML = summaryHtml();
        paintRange();
    }

    function summaryHtml() {
        const box = (label, value, active) =>
            `<div class="dp-pill${active ? ' active' : ''}"><span>${label}</span>` +
            `<strong>${value ? shortDay(value) : '—'}</strong></div>`;
        // Live count while painting the range (hover / keyboard), final once picked
        const end = state.end || (state.picking === 'end' && state.hover > state.start ? state.hover : '');
        const n = state.start && end
            ? `<div class="dp-nights${state.end ? '' : ' dp-nights-preview'}">${tn(nights(state.start, end), '{n} night', '{n} nights')}</div>` : '';
        return box(t('Departure'), state.start, state.picking === 'start') +
               box(t('Return'), state.end, state.picking === 'end') + n;
    }

    /* Selected / in-range classes (also follows the mouse while picking return) */
    function paintRange() {
        const a = state.start;
        const b = state.end || (state.picking === 'end' && state.hover > a ? state.hover : '');
        monthsBox.querySelectorAll('button[data-date]').forEach(btn => {
            const d = btn.dataset.date;
            const isStart = d === a, isEnd = b && d === b;
            btn.classList.toggle('dp-start', isStart);
            btn.classList.toggle('dp-end', !!isEnd);
            btn.classList.toggle('dp-in', !!(a && b && d > a && d < b));
            btn.classList.toggle('dp-preview', !state.end && !!b);
            btn.setAttribute('aria-selected', String(isStart || !!isEnd));
            // Return can't be before departure: grey those out while picking it
            btn.classList.toggle('dp-before', state.picking === 'end' && a && d < a);
        });
        summary.innerHTML = summaryHtml();
    }

    function shiftView(n) {
        state.view = addMonths(state.view, n);
        render();
        focusDay(state.view, true);
    }

    /* ---------- focus & keyboard ---------- */
    function focusDay(day, soft) {
        const min = today(), max = maxDate();
        if (day < min) day = min;
        if (day > max) day = max;
        if (!MOBILE()) {
            const first = firstOfMonth(day);
            if (first < state.view || first > addMonths(state.view, 1)) {
                state.view = first; render();
            }
        }
        focusIso = day;
        monthsBox.querySelectorAll('button[data-date]').forEach(b => b.tabIndex = -1);
        const btn = monthsBox.querySelector(`button[data-date="${day}"]`);
        if (!btn) return;
        btn.tabIndex = 0;
        if (MOBILE()) {
            const month = btn.closest('.dp-month');
            if (month) monthsBox.scrollTop = month.offsetTop - monthsBox.offsetTop - 8;
            if (!soft) btn.focus({ preventScroll: true });
        } else {
            btn.focus({ preventScroll: true });
        }
    }

    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
        if (e.key === 'Tab') {       // keep focus inside the dialog
            const items = [...panel.querySelectorAll('button:not([disabled])')]
                .filter(b => b.tabIndex >= 0 && b.offsetParent !== null);
            if (!items.length) return;
            const i = items.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
            else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
            return;
        }
        const btn = e.target.closest && e.target.closest('button[data-date]');
        if (!btn) return;
        const d = btn.dataset.date;
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        let next = null;
        if (e.key in moves) next = plusDays(d, moves[e.key]);
        else if (e.key === 'PageUp') next = addMonths(d, -1).slice(0, 8) + d.slice(8);
        else if (e.key === 'PageDown') next = addMonths(d, 1).slice(0, 8) + d.slice(8);
        else if (e.key === 'Home') next = plusDays(d, -((parse(d).getDay() + 6) % 7));
        else if (e.key === 'End') next = plusDays(d, 6 - ((parse(d).getDay() + 6) % 7));
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!btn.disabled) pick(d); return; }
        if (next) {
            e.preventDefault();
            if (isNaN(parse(next))) next = plusDays(firstOfMonth(next), 27);
            focusDay(next);
            if (state.picking === 'end' && state.start) { state.hover = focusIso; paintRange(); }
        }
    }

    /* Desktop: drop the panel under the date fields */
    function position() {
        if (MOBILE()) { panel.style.top = panel.style.left = ''; return; }
        const row = startInput.closest('.detail-row') || startInput.closest('.field');
        const r = row.getBoundingClientRect();
        const w = Math.min(panel.offsetWidth || 640, window.innerWidth - 24);
        let left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
        panel.style.left = `${left + window.scrollX}px`;
        panel.style.top = `${r.top + window.scrollY + 70}px`;
    }

    /* ---------- public ---------- */
    function setup(start, end) {
        startInput = start; endInput = end;
        build();
        [[startInput, 'start'], [endInput, 'end']].forEach(([input, which]) => {
            const wrap = input.closest('.date-input');
            input.readOnly = true;                 // never open the browser's own picker
            input.tabIndex = -1;
            input.setAttribute('aria-hidden', 'true');
            wrap.setAttribute('role', 'button');
            wrap.setAttribute('tabindex', '0');
            wrap.setAttribute('aria-haspopup', 'dialog');
            wrap.setAttribute('aria-expanded', 'false');
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label) {
                if (!label.id) label.id = input.id + 'Label';
                wrap.setAttribute('aria-labelledby', label.id);
                label.addEventListener('click', e => { e.preventDefault(); open(which, wrap); });
            }
            wrap.addEventListener('click', e => { e.preventDefault(); open(which, wrap); });
            wrap.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(which, wrap); }
            });
        });
    }

    return { setup, open, close };
})();
