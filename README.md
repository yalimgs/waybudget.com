# WayBudget

Route budget planner: estimate the full cost of a trip (flights, accommodation,
food, local transfers, attractions) from origin, destination, dates and travelers.

Live: https://waybudget.com (Cloudflare, auto-deploys on push to `main`)

## Structure

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `style.css` | Styling (responsive) |
| `search.js` | City/airport autocomplete (keyboard + mouse) |
| `app.js` | Dates, travelers, validation, trip summary, budget rendering |
| `budget.js` | Budget model: base costs, price-level scaling, currency display |
| `data/prices.json` | Price level per country (USA = 1.0) + exchange rates for display |
| `data/cities.json` | ~3,000 cities that have a scheduled-service airport, with IATA codes and coordinates |
| `tools/build_cities.py` | Rebuilds `data/cities.json` |
| `tools/refresh_prices.py` | Refreshes `data/prices.json` (price levels, fallback FX, US inflation factor) |
| `tools/dump_geonames.js` | Exports GeoNames cities for `build_cities.py` |
| `.github/workflows/refresh-data.yml` | Runs both refreshes every Monday (retry Tuesday if Monday failed) |

## How the budget is estimated

All base costs in `BUDGET_MODEL` (top of `budget.js`) are typical US prices in USD.
They are scaled to the destination by its price level (World Bank PPP / market
exchange rate), softened with an exponent because tourist prices vary less than
general prices. Labels in the UI: **Live** (real price from an API), **Estimate**
(price-level model), **Rough** (placeholder until a live API is connected —
currently flights and hotels).

Plain HTML/CSS/JS, no build step. To run locally: `python -m http.server` in this
folder, then open http://localhost:8000 (opening `index.html` directly won't load the JSON).

## Deploying

Push to `main`; Cloudflare Pages deploys automatically (`functions/` becomes the API).
Before committing CSS/JS changes run `python3 tools/bump_version.py` — it stamps
`?v=<hash>` on the CSS/JS links in `index.html` so browsers fetch the new files
instead of serving cached copies (Cloudflare lets browsers cache CSS/JS for 4 hours).

## Data freshness

| Data | Refreshed |
|---|---|
| Exchange rates (display) | Hourly check via `/api/fx` (source updates daily) |
| Flight prices | Live, edge-cached 6 h |
| Hotel prices | Live, edge-cached 1 h |
| Country price levels, fallback FX, base-cost inflation | Weekly, Mondays (GitHub Actions) |
| Airport / city list | Weekly, Mondays (GitHub Actions) |

Run the weekly refresh by hand: GitHub → Actions → "Refresh data" → Run workflow.

## Rebuilding the city data

```
git clone --depth 1 https://github.com/davidmegginson/ourairports-data
# GeoNames cities dumped from the `all-the-cities` npm package as
# [[name, countryCode, population, lat, lon, altName], ...]
python3 tools/build_cities.py ourairports-data cities.json data/cities.json
```

Manual city-name fixes and search keywords live in `OVERRIDES` / `ALIASES` at the top of the script.

Data: [OurAirports](https://ourairports.com/) (public domain), [GeoNames](https://www.geonames.org/) (CC BY 4.0).
