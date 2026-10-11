#!/usr/bin/env python3
"""
Weekly refresh of data/prices.json (run by .github/workflows/refresh-data.yml).

What it updates
  level      Price level per country, USA = 1.0, brought forward to today:
               level = PPP_Y × (CPI_now / CPI_Y)_country ÷ (CPI_now / CPI_Y)_USA ÷ FX_today
             PPP_Y   World Bank GDP PPP conversion factor, latest year (PA.NUS.PPP)
             CPI     World Bank consumer price index, latest year (FP.CPI.TOTL)
             FX      today's market rate (local currency per USD)
  food       Restaurant price level per country (USA = 1.0), brought forward
             from the World Bank ICP benchmark (restaurants & hotels, 2021)
             with monthly price indexes:
               food = ICP_Y × (R_now / R_Y)_country ÷ (R_now / R_Y)_USA ÷ (FX_today / FX_Y)
             R country  Eurostat HICP "food & beverage serving services"
                        (CP111, monthly; EU, EEA, CH, TR, Balkans, GE) or,
                        elsewhere, World Bank monthly CPI (Global Economic Monitor)
             R USA      BLS CPI "food away from home" (CUUR0000SEFV, monthly)
             FX_Y       World Bank average exchange rate of the ICP year
             Countries without monthly data: overall level × ICP restaurant ratio
  fx         Fallback display rates (USD, EUR, GBP, TRY) used if /api/fx is down
  baseFactor US inflation since the base costs in budget.js were set
             (US CPI-U from the BLS, monthly). All US base costs are × this.
  foodBaseFactor  Same for food, with US restaurant prices (food away from home)

Each source is optional: if one fails, the previous values for that part are
kept and the run still succeeds. Sources are free and need no API key.

Usage: python3 tools/refresh_prices.py data/prices.json
"""
import datetime, json, os, sys, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/prices.json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DISPLAY = ['USD', 'EUR', 'GBP', 'TRY']

# Base costs in budget.js are expressed in US prices of this month
BASE_CPI_MONTH = '2026-08'

# GDP-wide price levels are unreliable where official and market exchange
# rates diverge; manual values also fill countries the World Bank lacks.
MANUAL = {'IR': 0.30, 'VE': 0.45, 'CU': 0.50, 'KP': 0.40, 'SY': 0.30, 'LB': 0.45, 'AF': 0.25,
          'HK': 0.75, 'TW': 0.55, 'YE': 0.30, 'ER': 0.35, 'SS': 0.40, 'EH': 0.40}
FALLBACK = {'CL': 0.55, 'SK': 0.62, 'BZ': 0.60}    # only if no World Bank value
PARENT = {'GP': 'FR', 'MQ': 'FR', 'RE': 'FR', 'GF': 'FR', 'YT': 'FR', 'BL': 'FR', 'MF': 'FR',
          'PM': 'FR', 'NC': 'FR', 'PF': 'FR', 'WF': 'FR', 'GU': 'US', 'AS': 'US', 'MP': 'US',
          'UM': 'US', 'VG': 'US', 'GG': 'GB', 'JE': 'GB', 'IM': 'GB', 'GI': 'GB', 'FK': 'GB',
          'SH': 'GB', 'MS': 'GB', 'AI': 'GB', 'CW': 'NL', 'SX': 'NL', 'BQ': 'NL', 'CC': 'AU',
          'CX': 'AU', 'NF': 'AU', 'CK': 'NZ', 'NU': 'NZ'}

FX_URLS = ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
           'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json']
C2C_URL = 'https://cdn.jsdelivr.net/npm/country-to-currency@3/index.js'
WB = 'https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&per_page=20000&date={a}:{b}'
BLS = 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0'
BLS_POST = 'https://api.bls.gov/publicAPI/v1/timeseries/data/'
EUROSTAT = ('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr'
            '?format=JSON&coicop18=CP111&unit=I15&sinceTimePeriod={y}-01')
GEM = ('https://api.worldbank.org/v2/country/all/indicator/CPTOTSAXN?source=15&format=json'
       '&per_page=30000&date={y}M01:{z}M12')
FXY = 'https://api.worldbank.org/v2/country/all/indicator/PA.NUS.FCRF?format=json&per_page=400&date={y}'
EUROSTAT_GEO = {'EL': 'GR', 'UK': 'GB'}
# Countries that switched currency after the ICP year: old units per new unit
CHANGEOVER = {'HR': 7.5345, 'BG': 1.95583, 'SL': 1000}
WB_SOURCES = 'https://api.worldbank.org/v2/sources?format=json&per_page=200'
WB_COUNTRIES = 'https://api.worldbank.org/v2/country?format=json&per_page=400'
ICP = ('https://api.worldbank.org/v2/sources/{src}/country/all/series/1111000;1000000'
       '/classification/PX.WL/time/YR{year}?format=json&per_page=2000')


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'waybudget-data-refresh'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8')


def log(msg):
    print(msg, flush=True)


FX_ERRORS = []


def latest_fx():
    for url in FX_URLS:
        try:
            data = json.loads(get(url))
            return data['date'], {k.upper(): v for k, v in data['usd'].items()}
        except Exception as e:
            log(f'  fx source failed ({url}): {e!r}')
            FX_ERRORS.append(f'{url.split("/")[2]}: {e!r}'[:160])
    return None, None


def country_currency():
    js = get(C2C_URL)
    body = js[js.index('{'):js.rindex('}') + 1]
    pairs = {}
    for part in body.strip('{}').split(','):
        if ':' in part:
            k, v = part.split(':', 1)
            k = k.strip().strip('"\''); v = v.strip().strip('"\'')
            if len(k) == 2 and len(v) == 3:
                pairs[k] = v
    if len(pairs) < 150:
        raise ValueError('country-to-currency parse failed')
    return pairs


def wb_series(indicator, years=12):
    """{ISO2: {year: value}} for a World Bank indicator."""
    this_year = datetime.date.today().year
    raw = json.loads(get(WB.format(ind=indicator, a=this_year - years, b=this_year)))
    out = {}
    for row in raw[1] or []:
        cc = (row.get('country') or {}).get('id')
        if row.get('value') is not None and cc and len(cc) == 2:
            out.setdefault(cc, {})[int(row['date'])] = float(row['value'])
    return out


def restaurant_ratios():
    """
    {ISO2: restaurant price level ÷ overall price level}, both relative to the
    USA, from the latest World Bank ICP benchmark (ICP 2021 today; a newer
    cycle is picked up automatically when the World Bank publishes it).
    """
    sources = json.loads(get(WB_SOURCES))[1]
    icp = []
    for src in sources:
        name = src.get('name', '')
        digits = ''.join(ch for ch in name if ch.isdigit())
        if name.upper().startswith('ICP') and len(digits) == 4:
            icp.append((int(digits), src['id']))
    year, src = max(icp)
    iso = {c['id']: c['iso2Code'] for c in json.loads(get(WB_COUNTRIES))[1]}
    data = json.loads(get(ICP.format(src=src, year=year)))['source']['data']
    pli = {}
    for obs in data:
        v = {x['concept']: x['id'] for x in obs['variable']}
        if obs.get('value') is not None and v.get('Country') in iso:
            pli.setdefault(iso[v['Country']], {})[v['Series']] = float(obs['value'])
    us = pli['US']
    out, rest = {}, {}
    for cc, s in pli.items():
        if '1111000' in s and '1000000' in s:
            out[cc] = (s['1111000'] / us['1111000']) / (s['1000000'] / us['1000000'])
        if '1111000' in s:
            rest[cc] = s['1111000'] / us['1111000']
    return year, out, rest


def bls_monthly(series, start_year):
    """{'YYYY-MM': value} for a BLS series from start_year to now (v1 API, max 10 years)."""
    body = json.dumps({'seriesid': [series], 'startyear': str(start_year),
                       'endyear': str(datetime.date.today().year)}).encode()
    req = urllib.request.Request(BLS_POST, data=body, headers={
        'Content-Type': 'application/json', 'User-Agent': 'waybudget-data-refresh'})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = json.loads(r.read().decode('utf-8'))
    vals = {}
    for row in raw['Results']['series'][0]['data']:
        try:
            if row['period'].startswith('M') and row['period'] != 'M13':
                vals[f"{row['year']}-{row['period'][1:]}"] = float(row['value'])
        except ValueError:
            pass
    if not vals:
        raise ValueError(f'BLS {series}: no data ({raw.get("message")})')
    return vals


def eurostat_restaurants(year):
    """{ISO2: {'YYYY-MM': index}} restaurant (CP111) HICP, monthly, from Eurostat."""
    d = json.loads(get(EUROSTAT.format(y=year), timeout=120))
    ids, size = d['id'], d['size']
    stride = {}
    acc = 1
    for dim, n in zip(reversed(ids), reversed(size)):
        stride[dim] = acc
        acc *= n
    geo = d['dimension']['geo']['category']['index']
    time = d['dimension']['time']['category']['index']
    out = {}
    for g, gi in geo.items():
        if len(g) != 2:
            continue                              # skip EU, EA20 ...
        cc = EUROSTAT_GEO.get(g, g)
        for t, ti in time.items():
            v = d['value'].get(str(gi * stride['geo'] + ti * stride['time']))
            if v is not None:
                out.setdefault(cc, {})[t] = float(v)
    return out


def gem_cpi(year, iso3to2):
    """{ISO2: {'YYYY-MM': index}} monthly headline CPI from the World Bank GEM."""
    raw = json.loads(get(GEM.format(y=year, z=datetime.date.today().year), timeout=180))
    out = {}
    for row in raw[1] or []:
        cc = iso3to2.get((row.get('country') or {}).get('id'))
        if cc and row.get('value') is not None and 'M' in row.get('date', ''):
            y, m = row['date'].split('M')
            out.setdefault(cc, {})[f'{y}-{int(m):02d}'] = float(row['value'])
    return out


def year_avg(series, year):
    vals = [v for k, v in series.items() if k.startswith(f'{year}-')]
    return sum(vals) / len(vals) if len(vals) >= 10 else None


def us_cpi():
    raw = json.loads(get(BLS))
    rows = raw['Results']['series'][0]['data']
    vals = {}
    for r in rows:
        try:
            if r['period'].startswith('M') and r['period'] != 'M13':
                vals[f"{r['year']}-{r['period'][1:]}"] = float(r['value'])
        except ValueError:
            pass   # months without data are published as '-'
    return vals


def main():
    prev = json.load(open(OUT)) if os.path.exists(OUT) else {}
    out = dict(prev)
    today = datetime.date.today().isoformat()
    notes = []

    # 1) Today's exchange rates (fallback display rates + price-level conversion)
    fx_date, fx = latest_fx()
    if fx:
        out['fx'] = {c: round(fx[c], 4) for c in DISPLAY}
        out['fxDate'] = fx_date
        notes.append(f'fx {fx_date}')
    else:
        notes.append('fx kept (' + ' | '.join(FX_ERRORS) + ')')

    # 2) Price levels brought forward to today
    try:
        if not fx:
            raise ValueError('no exchange rates')
        c2c = country_currency()
        ppp, cpi = wb_series('PA.NUS.PPP'), wb_series('FP.CPI.TOTL')
        us_cpi_wb = cpi.get('US', {})
        levels, ppp_years = {}, set()
        for cc, series in ppp.items():
            cur = c2c.get(cc)
            if not cur or cur not in fx or not series:
                continue
            y = max(series)
            if y < datetime.date.today().year - 4:
                continue
            factor = series[y]
            c_cpi, u_cpi = cpi.get(cc, {}), us_cpi_wb
            common = [yy for yy in c_cpi if yy >= y and yy in u_cpi]
            if y in c_cpi and y in u_cpi and common:
                yl = max(common)
                factor *= (c_cpi[yl] / c_cpi[y]) / (u_cpi[yl] / u_cpi[y])
            levels[cc] = round(min(1.6, max(0.12, factor / fx[cur])), 3)
            ppp_years.add(y)
        if len(levels) < 120:
            raise ValueError(f'only {len(levels)} countries')
        for cc, v in FALLBACK.items():
            levels.setdefault(cc, v)
        levels.update(MANUAL)
        for cc, parent in PARENT.items():
            if parent in levels:
                levels.setdefault(cc, levels[parent])
        out['level'] = dict(sorted(levels.items()))
        out['levelBasis'] = f'World Bank PPP {max(ppp_years)} + CPI, FX {fx_date}'
        notes.append(f'levels {len(levels)} countries ({out["levelBasis"]})')
    except Exception as e:
        notes.append(f'levels kept ({e!r})'[:300])

    # 2b) Restaurant price level per country. ICP benchmark brought forward
    #     with monthly indexes where available, otherwise today's overall
    #     level × how much pricier/cheaper restaurants are there (ICP).
    us_food = None
    try:
        icp_year, ratios, rest_pli = restaurant_ratios()
        if len(ratios) < 100:
            raise ValueError(f'only {len(ratios)} countries')
        food, how = {}, {'monthly restaurant index': 0, 'monthly CPI': 0, 'annual': 0}

        monthly = {}
        try:
            us_food = bls_monthly('CUUR0000SEFV', icp_year)
            iso3to2 = {c['id']: c['iso2Code'] for c in json.loads(get(WB_COUNTRIES))[1]}
            fxy = {}
            for row in json.loads(get(FXY.format(y=icp_year)))[1] or []:
                cc = iso3to2.get(row.get('countryiso3code')) or (row.get('country') or {}).get('id')
                if row.get('value'):
                    fxy[cc] = float(row['value']) / CHANGEOVER.get(cc, 1)
            sources = []
            try:
                sources.append(('monthly restaurant index', eurostat_restaurants(icp_year)))
            except Exception as e:
                notes.append(f'eurostat failed ({e!r})'[:200])
            try:
                sources.append(('monthly CPI', gem_cpi(icp_year, iso3to2)))
            except Exception as e:
                notes.append(f'world bank monthly CPI failed ({e!r})'[:200])
            c2c = country_currency()
            us_base = year_avg(us_food, icp_year)
            for label, data in sources:
                for cc, series in data.items():
                    if cc in monthly or cc not in rest_pli:
                        continue
                    base = year_avg(series, icp_year)
                    cur = c2c.get(cc)
                    if not base or cc not in fxy or not fx or cur not in fx:
                        continue
                    month = max(series)
                    if month < f'{datetime.date.today().year - 1}':
                        continue                      # stale series
                    us_month = max((m for m in us_food if m <= month), default=None)
                    if not us_month:
                        continue
                    lvl = (rest_pli[cc] * (series[month] / base) / (us_food[us_month] / us_base)
                           / (fx[cur] / fxy[cc]))
                    monthly[cc] = (lvl, label, month)
        except Exception as e:
            notes.append(f'monthly food indexes failed, using annual ({e!r})'[:300])

        for cc in sorted(set(out.get('level', {})) | set(monthly)):
            if cc in monthly:
                lvl, label, _ = monthly[cc]
                how[label] += 1
            else:
                r = ratios.get(cc) or ratios.get(PARENT.get(cc, ''))
                base_lvl = out.get('level', {}).get(cc)
                if not r or base_lvl is None:
                    continue
                lvl = base_lvl * r
                how['annual'] += 1
            food[cc] = round(min(2.0, max(0.15, lvl)), 3)
        for cc, parent in PARENT.items():
            if parent in food and cc not in monthly:
                food[cc] = food[parent]
        food['US'] = 1.0                                   # the reference itself
        if len(food) < 100:
            raise ValueError(f'only {len(food)} countries')
        out['food'] = dict(sorted(food.items()))
        latest = max((m for _, _, m in monthly.values()), default='-')
        out['foodBasis'] = (f'World Bank ICP {icp_year} restaurants & hotels, brought forward monthly '
                            f'(Eurostat HICP / World Bank CPI, BLS food away from home; latest {latest})')
        notes.append(f'food levels {len(food)} countries (' +
                     ', '.join(f'{k} {v}' for k, v in how.items()) + ')')
    except Exception as e:
        notes.append(f'food levels kept ({e!r})'[:300])

    # 3) US inflation since the base costs were set
    try:
        vals = us_cpi()
        latest = max(vals)
        # base month itself, or the last published month before it
        base = max((m for m in vals if m <= BASE_CPI_MONTH), default=None)
        if not base:
            raise ValueError(f'no CPI at or before {BASE_CPI_MONTH}')
        out['baseFactor'] = round(vals[latest] / vals[base], 4)
        out['baseCpi'] = {'base': base, 'latest': latest}
        notes.append(f'baseFactor {out["baseFactor"]} (US CPI {base} → {latest})')
    except Exception as e:
        out.setdefault('baseFactor', 1)
        notes.append(f'baseFactor kept ({e!r})'[:300])

    # 3b) Same for food: US restaurant prices (food away from home)
    try:
        if not us_food:
            raise ValueError('no BLS food away from home series')
        latest = max(us_food)
        base = max((m for m in us_food if m <= BASE_CPI_MONTH), default=None)
        if not base:
            raise ValueError(f'no food CPI at or before {BASE_CPI_MONTH}')
        out['foodBaseFactor'] = round(us_food[latest] / us_food[base], 4)
        notes.append(f'foodBaseFactor {out["foodBaseFactor"]} (US food away from home {base} → {latest})')
    except Exception as e:
        out.setdefault('foodBaseFactor', out.get('baseFactor', 1))
        notes.append(f'foodBaseFactor kept ({e!r})'[:300])

    out['generated'] = today
    out['refreshLog'] = notes   # what the last run did (kept for transparency)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    log('prices.json: ' + '; '.join(notes))
    # Non-zero exit if any part had to keep old values, so the workflow can
    # retry the next day (the parts that did succeed are already saved).
    if any('kept' in n for n in notes):
        sys.exit(1)


if __name__ == '__main__':
    main()
