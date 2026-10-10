#!/usr/bin/env python3
"""
Builds data/prices.json: a price-level factor per country (USA = 1.0) plus
current exchange rates for display currencies. The budget model in budget.js
scales its USD base costs by these factors.

Price level = PPP conversion factor (local currency per international $)
              / average market exchange rate (local currency per USD)

Sources (free/open):
  - PPP: World Bank ICP via https://github.com/datasets/ppp  (data/ppp-gdp.csv)
  - FX:  @fawazahmed0/currency-api npm snapshots (monthly 2024 for the average,
         latest for display conversion)
  - Country -> currency: country-to-currency npm package

Usage:
  python3 tools/build_prices.py <ppp-gdp.csv> <fx_dir_with_2024_snapshots> \
      <latest_usd.json> <country_to_currency.json> data/prices.json
"""
import csv, glob, json, statistics, sys, datetime

ppp_csv, fx_dir, latest_path, c2c_path, out_path = sys.argv[1:6]

# GDP-wide price levels are unreliable where official and market exchange
# rates diverge; use sensible manual values there.
# Also fills countries missing from the World Bank file (estimates).
MANUAL = {"IR": 0.30, "VE": 0.45, "CU": 0.50, "KP": 0.40, "SY": 0.30, "LB": 0.45, "AF": 0.25,
          "HK": 0.75, "TW": 0.55, "CL": 0.55, "SK": 0.62, "BZ": 0.60, "YE": 0.30, "ER": 0.35,
          "SS": 0.40, "EH": 0.40}
# Territories use their parent country's level (islands priced like the mainland or above).
PARENT = {"GP": "FR", "MQ": "FR", "RE": "FR", "GF": "FR", "YT": "FR", "BL": "FR", "MF": "FR",
          "PM": "FR", "NC": "FR", "PF": "FR", "WF": "FR", "GU": "US", "AS": "US", "MP": "US",
          "UM": "US", "VG": "US", "GG": "GB", "JE": "GB", "IM": "GB", "GI": "GB", "FK": "GB",
          "SH": "GB", "MS": "GB", "AI": "GB", "CW": "NL", "SX": "NL", "BQ": "NL", "CC": "AU",
          "CX": "AU", "NF": "AU", "CK": "NZ", "NU": "NZ"}
DISPLAY_CURRENCIES = ["USD", "EUR", "GBP", "TRY"]

fx = {}
for f in glob.glob(f"{fx_dir}/*2024.*/package/v1/currencies/usd.json"):
    for cur, rate in json.load(open(f))["usd"].items():
        fx.setdefault(cur, []).append(rate)
fx_avg = {c: statistics.mean(v) for c, v in fx.items()}

c2c = json.load(open(c2c_path))
ppp = {}
for r in csv.DictReader(open(ppp_csv, encoding="utf-8")):
    cc, year = r["Country ID"], int(r["Year"])
    if r["PPP"] and (cc not in ppp or year > ppp[cc][0]):
        ppp[cc] = (year, float(r["PPP"]))

levels = {}
for cc, (year, factor) in ppp.items():
    cur = (c2c.get(cc) or "").lower()
    if year >= 2022 and cur in fx_avg:
        levels[cc] = round(min(1.6, max(0.12, factor / fx_avg[cur])), 3)
levels.update(MANUAL)
for cc, parent in PARENT.items():
    levels.setdefault(cc, levels[parent])

latest = json.load(open(latest_path))
fx_now = {c: round(latest["usd"][c.lower()], 4) for c in DISPLAY_CURRENCIES}

out = {
    "generated": datetime.date.today().isoformat(),
    "fxDate": latest.get("date"),
    "fx": fx_now,                       # 1 USD = x currency
    "level": dict(sorted(levels.items())),
}
json.dump(out, open(out_path, "w"), separators=(",", ":"))
print(f"{len(levels)} countries, fx {fx_now} -> {out_path}")
