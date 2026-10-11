// Dumps GeoNames cities (via the all-the-cities npm package) for build_cities.py:
// [[name, countryCode, population, lat, lon, altName], ...]   (population >= 5000)
// Usage: node tools/dump_geonames.js <path-to-all-the-cities> out.json
const [, , pkg, out] = process.argv;
const cities = require(pkg);
const rows = cities.filter(c => c.population >= 5000)
    .map(c => [c.name, c.country, c.population, c.loc.coordinates[1], c.loc.coordinates[0], c.altName]);
require('fs').writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} cities -> ${out}`);
