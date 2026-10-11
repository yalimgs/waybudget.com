#!/usr/bin/env python3
"""
Real road distance and driving time from each city's main airport to the
city centre, using the public OSRM router on OpenStreetMap data (free).
Results are cached in data/roads.json ({IATA: [km, minutes]} or null when
there is no road route); only airports missing from the cache are queried,
politely (1 request/second, capped per run), so the cache fills up over a
few weekly runs and afterwards only new airports cost a request.

Usage: python3 tools/road_distances.py <ourairports_dir> data/cities.json data/roads.json [max_requests]
"""
import csv, json, math, os, sys, time, urllib.request

ap_dir, cities_path, out_path = sys.argv[1:4]
limit = int(sys.argv[4]) if len(sys.argv) > 4 else 1200
OSRM = 'https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=false'


def dist_km(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


airports = {r['iata_code'].strip(): (float(r['latitude_deg']), float(r['longitude_deg']))
            for r in csv.DictReader(open(f'{ap_dir}/airports.csv', encoding='utf-8'))
            if r['iata_code'].strip()}
cities = json.load(open(cities_path, encoding='utf-8'))
cache = json.load(open(out_path)) if os.path.exists(out_path) else {}

todo = [c for c in cities if c['a'][0] not in cache and c['a'][0] in airports]
print(f'{len(cache)} cached, {len(todo)} missing, querying up to {limit}', flush=True)
done = failed = 0
for c in todo[:limit]:
    code = c['a'][0]
    alat, alon = airports[code]
    url = OSRM.format(alon, alat, c['lon'], c['lat'])
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'waybudget.com data refresh (weekly)'})
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read())
        if body.get('code') == 'Ok' and body.get('routes'):
            route = body['routes'][0]
            km, mins = route['distance'] / 1000, route['duration'] / 60
            straight = dist_km(alat, alon, c['lat'], c['lon'])
            # ignore detours that point to a wrong match (islands, ferries)
            ok = km <= max(3 * straight, straight + 40) and km <= 200
            cache[code] = [round(km, 1), round(mins)] if ok else None
        else:
            cache[code] = None
        done += 1
    except Exception as e:
        failed += 1
        if failed >= 20:
            print('too many errors, stopping for this run', flush=True)
            break
    time.sleep(1.1)

with open(out_path, 'w') as f:
    json.dump(dict(sorted(cache.items())), f, separators=(',', ':'))
print(f'roads: {done} queried, {failed} errors, {len(cache)} cached', flush=True)
