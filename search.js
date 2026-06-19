// ============================================================================
// Module: search.js
// Purpose: Handles data fetching, city search logic, and text normalization.
// ============================================================================

/* Global data store and trip state */
let allData = [];
let tripData = { origin: "", destination: "" };

/* Load geographical data from the local JSON file */
fetch('countries+cities.json')
    .then(res => res.json())
    .then(data => { allData = data; })
    .catch(err => console.error('Data loading error:', err));

/**
 * Normalizes text to handle case sensitivity and special character variations.
 * Standardizes characters to their base form for consistent searching.
 */
function normalizeText(text) {
    return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/ı/g, 'i').replace(/i̇/g, 'i');
}

/**
 * Filters and displays city matches based on user input.
 * Implements token-based matching for better search accuracy.
 */
function filterCities(val, type) {
    const results = document.getElementById(type + 'Results');

    /* Clear trip data and hide results if the input is empty */
    if (val.trim() === "") {
        tripData[type] = "";
        results.style.display = 'none';
        updateRouteSummary();
        return;
    }

    results.innerHTML = '';
    if (val.length < 2) { results.style.display = 'none'; return; }

    /* Parse search input into tokens for flexible matching */
    const queryTokens = normalizeText(val).replace(/,/g, ' ').split(' ').filter(t => t.length > 0);
    let matches = [];

    /* Search through the data store for matching city-country combinations */
    allData.forEach(country => {
        country.cities.forEach(city => {
            const fullString = normalizeText(`${city} ${country.name}`);
            const isMatch = queryTokens.every(t => fullString.includes(t));

            if (isMatch) {
                let score = normalizeText(city).startsWith(queryTokens[0]) ? 100 : 50;
                matches.push({ name: `${city}, ${country.name}`, score: score });
            }
        });
    });

    /* Rank matches based on the scoring system */
    matches.sort((a, b) => b.score - a.score);

    /* Render matching list items to the DOM */
    if (matches.length > 0) {
        results.style.display = 'block';
        matches.slice(0, 8).forEach(item => {
            const li = document.createElement('li');
            li.textContent = item.name;
            li.onclick = () => {
                document.getElementById(type).value = item.name;
                tripData[type] = item.name;
                results.style.display = 'none';
                updateRouteSummary();
            };
            results.appendChild(li);
        });
    } else {
        results.style.display = 'none';
    }
}