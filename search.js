// ============================================================================
// Module: search.js
// Purpose: Loads the city/airport dataset and powers the autocomplete fields.
// Data: data/cities.json, built by tools/build_cities.py. Each entry:
//   { n: city, c: country, cc: ISO code, lat, lon,
//     a: [IATA codes, main first], an: [airport names], k: keywords, l: 1 if large airport }
// ============================================================================

/* Selected cities (full objects, or null when nothing valid is selected) */
const tripData = { origin: null, destination: null };

let allCities = [];
const MAX_RESULTS = 8;

/* Load the dataset once; searching waits for this promise */
const citiesReady = fetch('data/cities.json')
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        allCities = data.map(city => ({
            ...city,
            label: `${city.n}, ${city.c}`,
            nameNorm: normalizeText(city.n),
            words: normalizeText([city.n, city.c, city.k, ...city.an].join(' ')).split(/[\s\-\/']+/),
            codes: city.a.map(code => code.toLowerCase()),
            keywords: normalizeText(city.k).split(' ').filter(Boolean)
        }));
    })
    .catch(err => console.error('City data could not be loaded:', err));

/**
 * Lowercases and strips accents so "İzmir", "izmir" and "IZMIR" all match.
 */
function normalizeText(text) {
    return (text || '')
        .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim();
}

/**
 * Returns the best-matching cities for a query, highest score first.
 */
function searchCities(query) {
    const q = normalizeText(query).replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (q.length < 2) return [];
    const tokens = q.split(' ');

    const matches = [];
    for (const city of allCities) {
        let score = 0;

        if (city.codes.includes(q)) score = 1000;                        // "ist"
        else if (city.nameNorm === q) score = 900;                       // "paris"
        else if (city.keywords.includes(q)) score = 800;                 // "bali" -> Denpasar
        else if (city.nameNorm.startsWith(q)) score = 700;               // "pari"
        else if (tokens.every(t => city.words.some(w => w.startsWith(t)))) {
            // every typed word starts a word in city/country/airport names
            score = city.words.slice(0, 3).some(w => w.startsWith(tokens[0])) ? 400 : 200;
        }
        if (!score) continue;

        if (city.l) score += 50;                                         // big hubs first
        score += Math.min(city.a.length, 4) * 5;                         // multi-airport cities
        matches.push({ city, score });
    }

    matches.sort((a, b) => b.score - a.score || a.city.n.localeCompare(b.city.n));
    return matches.slice(0, MAX_RESULTS).map(m => m.city);
}

/**
 * Wires one text input + results list into an accessible autocomplete.
 * type is 'origin' or 'destination'.
 */
function setupAutocomplete(type) {
    const input = document.getElementById(type);
    const list = document.getElementById(type + 'Results');
    let results = [];
    let activeIndex = -1;

    function close() {
        list.classList.remove('open');
        list.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        activeIndex = -1;
    }

    function select(city) {
        tripData[type] = city;
        input.value = city.label;
        input.classList.remove('invalid');
        close();
        document.dispatchEvent(new CustomEvent('trip:change'));
    }

    function highlight(index) {
        const items = list.querySelectorAll('li');
        items.forEach(li => li.classList.remove('active'));
        activeIndex = index;
        if (index >= 0 && items[index]) {
            items[index].classList.add('active');
            items[index].scrollIntoView({ block: 'nearest' });
            input.setAttribute('aria-activedescendant', items[index].id);
        }
    }

    function render() {
        list.innerHTML = '';
        if (!results.length) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = t('No airport city found');
            list.appendChild(empty);
        }
        results.forEach((city, i) => {
            const li = document.createElement('li');
            li.id = `${type}-opt-${i}`;
            li.setAttribute('role', 'option');

            const main = document.createElement('span');
            main.className = 'opt-main';
            const name = document.createElement('strong');
            name.textContent = city.n;
            const country = document.createElement('span');
            country.className = 'opt-country';
            country.textContent = city.c;
            main.append(name, country);

            const codes = document.createElement('span');
            codes.className = 'opt-codes';
            codes.textContent = city.a.slice(0, 3).join(' · ') + (city.a.length > 3 ? ' …' : '');

            li.append(main, codes);
            // mousedown fires before the input's blur, so the click is not lost
            li.addEventListener('mousedown', e => { e.preventDefault(); select(city); });
            list.appendChild(li);
        });
        list.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
        highlight(results.length ? 0 : -1);
    }

    input.addEventListener('input', async () => {
        // Any edit invalidates the previous selection (fixes stale city bug)
        if (tripData[type]) {
            tripData[type] = null;
            document.dispatchEvent(new CustomEvent('trip:change'));
        }
        const value = input.value;
        if (normalizeText(value).length < 2) { close(); return; }
        await citiesReady;
        if (input.value !== value) return;   // user kept typing meanwhile
        results = searchCities(value);
        render();
    });

    input.addEventListener('keydown', e => {
        const isOpen = list.classList.contains('open');
        if (e.key === 'ArrowDown' && isOpen) {
            e.preventDefault();
            highlight(Math.min(activeIndex + 1, results.length - 1));
        } else if (e.key === 'ArrowUp' && isOpen) {
            e.preventDefault();
            highlight(Math.max(activeIndex - 1, 0));
        } else if (e.key === 'Enter' && isOpen && activeIndex >= 0) {
            e.preventDefault();
            select(results[activeIndex]);
        } else if (e.key === 'Escape') {
            close();
        } else if (e.key === 'Tab' && isOpen && activeIndex >= 0) {
            select(results[activeIndex]);
        }
    });

    input.addEventListener('blur', () => {
        // Accept an exact typed match without needing a click
        if (!tripData[type] && input.value.trim()) {
            const exact = searchCities(input.value)
                .find(c => normalizeText(c.label) === normalizeText(input.value) ||
                           c.nameNorm === normalizeText(input.value));
            if (exact) select(exact);
        }
        close();
    });

    return { select, input };
}
