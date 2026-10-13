// ============================================================================
// Module: i18n.js
// Purpose: English (default) / Turkish. English text is the key; t() returns
// the Turkish version when Turkish is selected. The choice is remembered in
// this browser. Static page text is marked with data-i18n attributes.
// ============================================================================

const TR = {
    // Page
    'How much will your trip really cost?': 'Seyahatin gerçekte ne kadar tutar?',
    'Trip Budget Calculator': 'Seyahat Bütçesi Hesaplama',
    'Flights, hotels, food and transfers': 'Uçak, otel, yemek ve transferler',
    'One total, from door to door': 'Kapıdan kapıya tek toplam',
    'From': 'Nereden', 'To': 'Nereye', 'Departure': 'Gidiş', 'Return': 'Dönüş', 'Travelers': 'Yolcu',
    'City or airport': 'Şehir veya havalimanı',
    'Select date': 'Tarih seç',
    'Calculate my budget': 'Bütçemi hesapla',
    'Your trip budget': 'Seyahat bütçen',
    'Total': 'Toplam',
    'Budget': 'Ekonomik', 'Standard': 'Standart', 'Luxury': 'Lüks',
    'Real prices': 'Gerçek fiyatlar',
    'Based on local price levels': 'Yerel fiyat seviyesine göre',
    'Fallback when no live price is available': 'Canlı fiyat yokken kullanılan tahmin',
    'Not included:': 'Dahil değil:',
    'visa · travel insurance · baggage fees · city/tourist tax · tours & entry fees · SIM / roaming · shopping':
        'vize · seyahat sigortası · bagaj ücreti · konaklama vergisi · tur ve giriş ücretleri · telefon hattı · alışveriş',
    'Data:': 'Veri:', 'Prices:': 'Fiyatlar:',
    'Swap origin and destination': 'Nereden ve nereye yer değiştir',
    'Fewer travelers': 'Yolcu azalt', 'More travelers': 'Yolcu artır',
    'Between 1 and 20 travelers.': '1 ile 20 arası yolcu.',
    'No airport city found': 'Havalimanı olan şehir bulunamadı',

    // Errors
    'Please pick your cities from the suggestion list.': 'Lütfen şehirleri öneri listesinden seç.',
    'Please fill in origin, destination and both dates.': 'Lütfen nereden, nereye ve iki tarihi de doldur.',
    'Please add: {fields}.': 'Lütfen ekle: {fields}.',
    'Departure date': 'Gidiş tarihi', 'Return date': 'Dönüş tarihi',
    'Trips can be up to {n} nights. Please choose an earlier return date.': 'En fazla {n} gecelik seyahat hesaplanabiliyor. Lütfen daha erken bir dönüş tarihi seç.',
    'Calculate my WayBudget': 'WayBudget\'ımı hesapla',
    'Origin and destination cannot be the same. Please choose different cities.':
        'Nereden ve nereye aynı olamaz. Lütfen farklı şehirler seç.',
    'Departure date cannot be in the past.': 'Gidiş tarihi geçmişte olamaz.',
    'Return date must be at least one day after departure.': 'Dönüş tarihi gidişten en az bir gün sonra olmalı.',

    // Summary
    '{n} night': '{n} gece', '{n} nights': '{n} gece', 'night': 'gece', 'nights': 'gece',
    '{n} traveler': '{n} yolcu', '{n} travelers': '{n} yolcu',
    '{p} per person': 'kişi başı {p}',
    ' · rates of {date}': ' · {date} kuru',

    // Items, options, badges
    'Flights': 'Uçak', 'Hotel': 'Otel', 'Food & drinks': 'Yemek ve içecek',
    'Airport transfers': 'Havalimanı transferi', 'Local transport': 'Şehir içi ulaşım',
    'Economy': 'Ekonomi', 'Premium': 'Premium', 'None': 'Yok',
    'Street food': 'Sokak yemeği', 'Casual': 'Restoran', 'Fine dining': 'Gurme',
    'Public': 'Toplu taşıma', 'Taxi': 'Taksi', 'Private': 'Özel', 'Mixed': 'Karma',
    'Live': 'Canlı', 'Estimate': 'Tahmini', 'Approx.': 'Yaklaşık', 'Working…': 'Hesaplanıyor…',
    '{label} option': '{label} seçeneği',

    // Item details
    'Round trip {a} ⇄ {b}': 'Gidiş-dönüş {a} ⇄ {b}',
    'Direct': 'Direkt', '{n} stop': '{n} aktarma', '{n} stops': '{n} aktarma',
    '{out} out, {back} back': 'gidiş {out}, dönüş {back}',
    'See flights': 'Uçuşları gör',
    'Previous month': 'Önceki ay', 'Next month': 'Sonraki ay', 'Close': 'Kapat',
    'Clear': 'Temizle', 'Done': 'Tamam', 'Choose your travel dates': 'Seyahat tarihlerini seç',
    'Pick your departure date': 'Gidiş tarihini seç', 'Pick your return date': 'Dönüş tarihini seç',
    'Now pick your return date': 'Şimdi dönüş tarihini seç',
    'See hotel': 'Oteli gör',
    'Typical fare': 'Tipik fiyat', 'Business class': 'Business sınıfı',
    'closest fare seen: {dates}': 'en yakın görülen fiyat: {dates}',
    'few fares seen for these dates': 'bu tarihler için az uçuş görüldü',
    '{n} room': '{n} oda', '{n} rooms': '{n} oda',
    '{p}/night': '{p}/gece', 'e.g. {name}': 'örn. {name}',
    '{t} × {d} days · ~{p} per person/day': '{t} × {d} gün · kişi başı günlük ~{p}',
    '{n} car': '{n} araç', '{n} cars': '{n} araç',
    'both ways': 'gidiş-dönüş', '~{p} per ride': 'yolculuk başı ~{p}',
    'city centre': 'şehir merkezi', '(~{m} min)': '(~{m} dk)',
    'Not included': 'Dahil değil',

    // Sources (tooltips)
    'Fares seen recently for these months (Aviasales)': 'Bu aylar için son günlerde görülen fiyatlar (Aviasales)',
    'Fares seen recently for these dates (Aviasales)': 'Bu tarihler için son günlerde görülen fiyatlar (Aviasales)',
    'Lowest of {n} fares seen recently (Aviasales)': 'Son günlerde görülen {n} fiyatın en düşüğü (Aviasales)',
    'Typical (median) of {n} fares seen recently (Aviasales)': 'Son günlerde görülen {n} fiyatın ortancası (Aviasales)',
    'Lowest live fare + typical markup seen on this route': 'En düşük canlı fiyat + bu rotadaki tipik fark',
    'Too few fares seen; estimated from the lowest live fare': 'Yeterli uçuş yok; en düşük canlı fiyattan tahmin',
    'Lowest business-class fare seen recently (Aviasales)': 'Son günlerde görülen en ucuz business bileti (Aviasales)',
    'Estimated from live economy fares': 'Canlı ekonomi fiyatlarından tahmin',
    'Loading live fares': 'Canlı fiyatlar yükleniyor',
    'Distance-based estimate (no live fare found)': 'Mesafeye dayalı tahmin (canlı fiyat bulunamadı)',
    'Live rates for your dates, {n} hotels compared': 'Seçtiğin tarihler için canlı fiyatlar, {n} otel karşılaştırıldı',
    'Loading live hotel rates': 'Canlı otel fiyatları yükleniyor',
    'Price-level estimate (no live rates found)': 'Fiyat seviyesine dayalı tahmin (canlı fiyat bulunamadı)',
    'Based on the destination country\'s restaurant prices': 'Gidilen ülkenin restoran fiyatlarına göre',
    'Distance to the example hotel, estimated from this city\'s road network; taxi fares estimated':
        'Örnek otele mesafe, şehrin yol ağından tahmin; taksi ücreti tahmini',
    '{c} → city centre: {k} km by road (OpenStreetMap)': '{c} → şehir merkezi: yol ile {k} km (OpenStreetMap)',
    '{c} is ~{k} km from the city centre (straight line)': '{c} şehir merkezine kuş uçuşu ~{k} km',
    'Metro, bus, tram and short rides while sightseeing': 'Gezerken metro, otobüs, tramvay ve kısa yolculuklar'
};

let LANG = 'en';
try { if (localStorage.getItem('wb-lang') === 'tr') LANG = 'tr'; } catch (e) { /* storage blocked */ }

/** Translate an English string; {name} placeholders are filled from vars. */
function t(text, vars = {}) {
    const s = (LANG === 'tr' && TR[text]) || text;
    return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Singular/plural English key chosen by n, e.g. tn(2, '{n} night', '{n} nights') */
function tn(n, one, many, vars = {}) {
    return t(n === 1 ? one : many, { n, ...vars });
}

function dateLocale() {
    return LANG === 'tr' ? 'tr-TR' : 'en-GB';
}

/* Applies the language to text marked in the HTML */
function applyStaticText() {
    document.documentElement.lang = LANG;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    const btn = document.getElementById('langBtn');
    if (btn) {
        btn.textContent = LANG === 'tr' ? 'English' : 'Türkçe';
        btn.setAttribute('lang', LANG === 'tr' ? 'en' : 'tr');
    }
}

function setLanguage(lang) {
    LANG = lang;
    try { localStorage.setItem('wb-lang', lang); } catch (e) { /* storage blocked */ }
    applyStaticText();
    document.dispatchEvent(new CustomEvent('lang:change'));
}
