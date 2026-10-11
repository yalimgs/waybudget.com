#!/usr/bin/env python3
"""
Monthly refresh of data/prices.json (run by .github/workflows/refresh-data.yml).

What it updates
  level      Price level per country, USA = 1.0, brought forward to today:
               level = PPP_Y × (CPI_now / CPI_Y)_country ÷ (CPI_now / CPI_Y)_USA ÷ FX_today
             PPP_Y   World Bank GDP PPP conversion factor, latest year (PA.NUS.PPP)
             CPI     World Bank consumer price index, latest year (FP.CPI.TOTL)
             FX      today's market rate (local currency per USD)
  fx         Fallback display rates (USD, EUR, GBP, TRY) used if /api/fx is down
  baseFactor US inflation since the base costs in budget.js were set
             (US CPI-U from the BLS, monthly). All US base costs are × this.

Each source is optional: if one fails, the previous values for that part are
kept and the run still succeeds. Sources are free and need no API key.

Usage: python3 tools/refresh_prices.py data/prices.json
"""
import datetime, json, os, sys, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data/prices.json'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DISPLAY = ['USD', 'EUR', 'GBP', 'TRY']

# Base costs in budget.js are expressed in US prices of this month
BASE_CPI_MONTH = '2026-09'

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


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': 'waybudget-data-refresh'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8')


def log(msg):
    print(msg, flush=True)


def latest_fx():
    for url in FX_URLS:
        try:
            data = json.loads(get(url))
            return data['date'], {k.upper(): v for k, v in data['usd'].items()}
        except Exception as e:
            log(f'  fx source failed ({url}): {e}')
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


def us_cpi():
    raw = json.loads(get(BLS))
    rows = raw['Results']['series'][0]['data']
    vals = {f"{r['year']}-{r['period'][1:]}": float(r['value']) for r in rows if r['period'].startswith('M')
            and r['period'] != 'M13'}
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
        notes.append('fx kept')

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
        notes.append(f'levels kept ({e})')

    # 3) US inflation since the base costs were set
    try:
        vals = us_cpi()
        latest = max(vals)
        if BASE_CPI_MONTH not in vals:
            raise ValueError(f'base month {BASE_CPI_MONTH} not in BLS response')
        out['baseFactor'] = round(vals[latest] / vals[BASE_CPI_MONTH], 4)
        out['baseCpi'] = {'base': BASE_CPI_MONTH, 'latest': latest}
        notes.append(f'baseFactor {out["baseFactor"]} (US CPI {BASE_CPI_MONTH} → {latest})')
    except Exception as e:
        out.setdefault('baseFactor', 1)
        notes.append(f'baseFactor kept ({e})')

    out['generated'] = today
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    log('prices.json: ' + '; '.join(notes))


if __name__ == '__main__':
    main()
