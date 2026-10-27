# WayBudget

**How much will your trip really cost?** WayBudget gives one door-to-door total for a trip:
flights, hotel, food, airport transfers and local transport.

Live: **https://waybudget.com** · English and Turkish · USD, EUR, GBP, TRY

_Last updated: 27 October 2026_

## What it does

- Pick from, to, dates and travelers. You get a total and a per-person price.
- Each item has its own level: Budget, Standard or Luxury, or None to leave it out.
- Live flight and hotel prices, each with a link to that exact ticket or hotel list.
- "Only direct flights" switch.
- Shows how many prices were found, and when the fare was seen.
- **Share this budget**: a link that reopens the same calculation. Expired dates ask for new ones.
- Remembers language, currency and choices on the visitor's device.
- Custom date-range calendar that works the same on phone and desktop.

## Where the numbers come from

| Item | Source | Notes |
|---|---|---|
| Flights | Travelpayouts / Aviasales Data API | Fares seen in recent searches. Economy is the cheapest; Standard is the median, preferring direct flights. Premium is business class when seen. Small airports with no fares are priced through a nearby hub. |
| Hotels | LiteAPI live rates | Hotels within 6 km of the centre, widened to 20 km if few are found. Budget, Standard and Luxury tiers are picked from the results. |
| Food | World Bank ICP restaurant price levels | Brought forward monthly with Eurostat, World Bank and BLS indexes. |
| Transfers and local transport | Road distance (OpenStreetMap) × local taxi and transit prices | Uses the country's price level. |
| Exchange rates | fawazahmed0 currency-api (free, daily) | Through `/api/fx`, cached for 1 hour |

Every line is labelled **Live** (real price), **Estimate** (model) or **Approx.** (fallback).

## Tech

- Plain HTML, CSS and JavaScript. No framework, no build step.
- **Cloudflare Pages** hosts the site. **Pages Functions** (`functions/api`) call the price APIs and cache results at the edge.
- **GitHub Actions** refreshes price and inflation data every Monday, with a retry on Tuesday.
- API keys live only in Cloudflare environment variables (`TRAVELPAYOUTS_TOKEN`, `LITEAPI_KEY`). None are in the code.

## Files

| Path | Purpose |
|---|---|
| `index.html`, `style.css` | Page and styling |
| `app.js` | Form, validation, results, sharing, saved preferences |
| `budget.js` | Budget model and price API calls |
| `search.js` | City and airport autocomplete |
| `datepicker.js` | Range calendar |
| `i18n.js` | English and Turkish text |
| `functions/api/` | `flights.js`, `hotels.js`, `fx.js` (server side) |
| `data/` | `cities.json` (3,082 cities with airports), `prices.json`, `roads.json` |
| `tools/` | Scripts that rebuild the data files |

## Run locally

```bash
python3 -m http.server
```

Open http://localhost:8000. The page works offline from the data files.
Live flight and hotel prices need Cloudflare (`npx wrangler pages dev .` with the two keys set).

## Deploy

Push to `main` and Cloudflare deploys automatically.
Before committing CSS or JS changes, run `python3 tools/bump_version.py`. It adds a version to the file links so visitors get the new files.

## Roadmap

- Destination pages, such as `/destinations/rome`, with typical costs and the cheapest dates
- Type your trip in plain words (AI)
- Plan a trip together in real time

---

© 2026 Yalım Özçağlayan. All rights reserved.
