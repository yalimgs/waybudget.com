#!/usr/bin/env python3
"""
Builds data/cities.json: every city with a scheduled-service airport, plus its
IATA codes and coordinates. Used by the city search and (later) flight estimates.

Sources (both free/open):
  - OurAirports airports.csv + countries.csv (public domain)
      https://github.com/davidmegginson/ourairports-data
  - GeoNames cities (CC BY 4.0) via the all-the-cities npm package, dumped as
    [[name, countryCode, population, lat, lon, altName], ...]

Usage:
  python3 tools/build_cities.py <ourairports_dir> <geonames_cities.json> data/cities.json
"""
import csv, json, math, os, re, sys, unicodedata
from collections import defaultdict

ap_dir, cities_path, out_path = sys.argv[1:4]

# Manual fixes where the automatic mapping picks the wrong city name.
OVERRIDES = {
    "SAW": "Istanbul", "IST": "Istanbul", "ADB": "Izmir", "CDG": "Paris", "ORY": "Paris",
    "BVA": "Paris", "STN": "London", "LTN": "London", "LCY": "London", "LHR": "London",
    "LGW": "London", "NRT": "Tokyo", "HND": "Tokyo", "EWR": "New York City", "JFK": "New York City",
    "LGA": "New York City", "BJV": "Bodrum", "DLM": "Dalaman", "GZP": "Alanya",
    "SVO": "Moscow", "DME": "Moscow", "VKO": "Moscow", "FCO": "Rome", "CIA": "Rome",
    "MXP": "Milan", "LIN": "Milan", "BGY": "Milan", "KIX": "Osaka", "ITM": "Osaka",
    "ICN": "Seoul", "GMP": "Seoul", "PVG": "Shanghai", "SHA": "Shanghai",
    "PEK": "Beijing", "PKX": "Beijing", "DXB": "Dubai", "DWC": "Dubai",
    "IAD": "Washington", "DCA": "Washington", "BWI": "Baltimore",
    "ORD": "Chicago", "MDW": "Chicago", "BKK": "Bangkok", "DMK": "Bangkok",
    "GRU": "São Paulo", "CGH": "São Paulo", "VCP": "Campinas", "EZE": "Buenos Aires",
    "AEP": "Buenos Aires", "SXF": "Berlin", "BER": "Berlin", "TFS": "Tenerife",
    "TFN": "Tenerife", "ARN": "Stockholm", "BMA": "Stockholm", "NYO": "Stockholm",
    "OSL": "Oslo", "CPH": "Copenhagen", "AMS": "Amsterdam", "BCN": "Barcelona",
    "MAD": "Madrid", "LIS": "Lisbon", "VIE": "Vienna", "ZRH": "Zurich", "GVA": "Geneva",
    "MUC": "Munich", "FRA": "Frankfurt", "HHN": "Frankfurt", "DUS": "Düsseldorf",
    "BRU": "Brussels", "CRL": "Brussels", "ATH": "Athens", "SJJ": "Sarajevo",
    "TLV": "Tel Aviv", "CAI": "Cairo", "SYD": "Sydney", "MEL": "Melbourne",
    "YYZ": "Toronto", "YTZ": "Toronto", "YUL": "Montreal", "YVR": "Vancouver",
    "LAX": "Los Angeles", "SFO": "San Francisco", "MIA": "Miami", "FLL": "Fort Lauderdale",
    "ECN": "Nicosia", "DOH": "Doha", "AUH": "Abu Dhabi", "VCE": "Venice",
    "TSF": "Venice", "KNO": "Medan", "LCG": "A Coruña", "OVD": "Oviedo", "PAD": "Paderborn",
    "FMO": "Münster", "CHQ": "Chania", "HER": "Heraklion", "RHO": "Rhodes",
}

# Extra search keywords (islands, regions, popular nearby resorts).
ALIASES = {
    "DPS": "Bali", "ACE": "Lanzarote", "FUE": "Fuerteventura", "LPA": "Gran Canaria",
    "PMI": "Mallorca Majorca", "MAH": "Menorca Minorca", "IBZ": "Ibiza",
    "DLM": "Fethiye Marmaris Göcek Muğla", "BJV": "Milas Muğla", "GZP": "Gazipaşa",
    "AYT": "Belek Side Kemer", "NAV": "Cappadocia Kapadokya", "ASR": "Cappadocia Kapadokya",
    "COV": "Adana Mersin Çukurova", "TEQ": "Tekirdağ", "EDO": "Balıkesir Ayvalık",
    "JTR": "Thira Fira", "CFU": "Kerkyra", "HER": "Crete", "CHQ": "Crete",
    "JMK": "Mykonos", "USM": "Samui", "HKT": "Phuket", "CUN": "Riviera Maya Playa del Carmen",
    "SJD": "Los Cabos", "MLE": "Maldives", "SEZ": "Seychelles", "MRU": "Mauritius",
    "ECN": "Lefkoşa Northern Cyprus", "LCA": "Cyprus Ayia Napa", "PFO": "Cyprus",
    "SSH": "Sharm", "HRG": "Hurghada", "RAK": "Marrakech", "MLA": "Malta",
}
# Airports that should be listed first for their city even if another has a longer runway.
PRIMARY = {"DXB", "SVO", "BKK", "LHR", "CDG", "IST", "JFK", "FCO", "HND", "MXP", "ORD", "ICN", "PEK", "PVG"}
TYPE_RANK = {"large_airport": 0, "medium_airport": 1}


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.lower().replace("ı", "i").strip()


def dist_km(a, b, c, d):
    p = math.pi / 180
    h = (math.sin((c - a) * p / 2) ** 2
         + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


countries = {r["code"]: r["name"] for r in csv.DictReader(open(f"{ap_dir}/countries.csv", encoding="utf-8"))}

# GeoNames cities, bucketed by country for nearest-city lookups
geo = defaultdict(list)
for name, cc, pop, lat, lon, alt in json.load(open(cities_path, encoding="utf-8")):
    geo[cc].append((name, pop, lat, lon))
geo_by_name = defaultdict(list)
for cc, lst in geo.items():
    for name, pop, lat, lon in lst:
        geo_by_name[(cc, norm(name))].append((name, pop, lat, lon))


def pick_city(ap):
    """Return (display_name, lat, lon) for the city an airport serves."""
    cc, lat, lon = ap["iso_country"], float(ap["latitude_deg"]), float(ap["longitude_deg"])
    code = ap["iata_code"].strip()

    if code in OVERRIDES:
        target = norm(OVERRIDES[code])
        cands = geo_by_name.get((cc, target))
        if cands:
            n, p, la, lo = max(cands, key=lambda x: x[1])
            return n, la, lo
        return OVERRIDES[code], lat, lon

    # Municipality text, e.g. "Paris (Roissy-en-France, Val-d'Oise)" -> "Paris"
    muni = re.sub(r"\(.*?\)", "", ap["municipality"]).strip()
    muni_parts = [m.strip() for m in muni.split(",") if m.strip()]

    nearby = [(n, p, la, lo, dist_km(lat, lon, la, lo)) for n, p, la, lo in geo.get(cc, [])]
    nearby = [x for x in nearby if x[4] <= 70]

    base = None
    for part in muni_parts:
        hits = [x for x in nearby if norm(x[0]) == norm(part) and x[4] <= 50]
        if hits:
            base = max(hits, key=lambda x: x[1])
            break

    # A much bigger city close by usually is what travellers search for
    # (Gaziemir -> Izmir, Narita -> Tokyo, Newark -> New York).
    if nearby:
        big = max(nearby, key=lambda x: x[1] / (x[4] + 10) ** 2)
        if base is None:
            if big[1] >= 20000 or not muni_parts:
                base = big
        elif big[1] >= 10 * base[1] and big[4] <= 60:
            base = big

    if base:
        return base[0], base[2], base[3]
    return (muni_parts[0] if muni_parts else ap["name"]), lat, lon


airports = [
    r for r in csv.DictReader(open(f"{ap_dir}/airports.csv", encoding="utf-8"))
    if r["type"] in TYPE_RANK and r["scheduled_service"] == "yes" and r["iata_code"].strip()
]

# Longest runway per airport: a decent proxy for "main airport" (CDG over BVA).
runway = defaultdict(int)
for r in csv.DictReader(open(f"{ap_dir}/runways.csv", encoding="utf-8")):
    try:
        runway[r["airport_ident"]] = max(runway[r["airport_ident"]], int(r["length_ft"] or 0))
    except ValueError:
        pass

regions = {r["code"]: r["name"] for r in csv.DictReader(open(f"{ap_dir}/regions.csv", encoding="utf-8"))}

# Same-name cities far apart (Columbus OH vs Columbus GA) must stay separate.
clusters = defaultdict(list)
for ap in sorted(airports, key=lambda a: TYPE_RANK[a["type"]]):
    name, lat, lon = pick_city(ap)
    key = (ap["iso_country"], norm(name))
    g = next((g for g in clusters[key] if dist_km(lat, lon, g["lat"], g["lon"]) <= 120), None)
    if g is None:
        g = {"n": name, "cc": ap["iso_country"], "rg": regions.get(ap["iso_region"], ""),
             "c": countries.get(ap["iso_country"], ap["iso_country"]),
             "lat": round(lat, 3), "lon": round(lon, 3), "ap": [], "k": set()}
        clusters[key].append(g)
    code = ap["iata_code"].strip()
    g.setdefault("apll", {})[code] = (float(ap["latitude_deg"]), float(ap["longitude_deg"]))
    g["ap"].append((TYPE_RANK[ap["type"]], -(runway[ap["ident"]] + (100000 if ap["iata_code"].strip() in PRIMARY else 0)), code, ap["name"]))
    if code in ALIASES:
        g["k"].add(ALIASES[code])

groups = {}
for key, lst in clusters.items():
    for i, g in enumerate(lst):
        if len(lst) > 1:
            g["n"] = f'{g["n"]} ({g["rg"]})' if g["rg"] else g["n"]
        groups[(key, i)] = g

out = []
for g in groups.values():
    g["ap"].sort()
    out.append({
        "n": g["n"], "c": g["c"], "cc": g["cc"], "lat": g["lat"], "lon": g["lon"],
        "a": [x[2] for x in g["ap"]],                   # IATA codes, main airport first
        "an": [x[3] for x in g["ap"]],                  # airport names (searchable)
        # km from main airport to city centre (for transfer estimates)
        # (straight line; bogus values from unmatched cities fall back to 20 km)
        "d": (lambda km: km if km <= 90 else 20)(round(dist_km(g["lat"], g["lon"], *g["apll"][g["ap"][0][2]]))),
        "k": " ".join(sorted(g["k"])),                  # extra search keywords
        "l": 1 if any(x[0] == 0 for x in g["ap"]) else 0,  # has a large airport
    })

# Real road distance/time from the main airport (tools/road_distances.py cache)
roads_path = os.path.join(os.path.dirname(out_path), "roads.json")
roads = json.load(open(roads_path)) if os.path.exists(roads_path) else {}
for c in out:
    r = roads.get(c["a"][0])
    if r:
        c["rk"], c["rm"] = r            # road km, minutes

out.sort(key=lambda x: (-x["l"], x["n"]))
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(airports)} airports -> {len(out)} cities -> {out_path}")
