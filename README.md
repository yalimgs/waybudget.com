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
| `app.js` | Dates, travelers, validation, trip summary |
| `data/cities.json` | ~3,000 cities that have a scheduled-service airport, with IATA codes and coordinates |
| `tools/build_cities.py` | Rebuilds `data/cities.json` |

Plain HTML/CSS/JS, no build step. To run locally: `python -m http.server` in this
folder, then open http://localhost:8000 (opening `index.html` directly won't load the JSON).

## Rebuilding the city data

```
git clone --depth 1 https://github.com/davidmegginson/ourairports-data
# GeoNames cities dumped from the `all-the-cities` npm package as
# [[name, countryCode, population, lat, lon, altName], ...]
python3 tools/build_cities.py ourairports-data cities.json data/cities.json
```

Manual city-name fixes and search keywords live in `OVERRIDES` / `ALIASES` at the top of the script.

Data: [OurAirports](https://ourairports.com/) (public domain), [GeoNames](https://www.geonames.org/) (CC BY 4.0).
