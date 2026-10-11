"""
Other names people type for popular cities: Turkish names (Roma, Londra,
Atina...) and native spellings (Wien, München, Lisboa...). Keyed by the
city's main IATA code; merged into each city's search keywords so that
"Roma" finds Rome, Italy before Roma, Australia.
"""
EXONYMS = {
    # Europe
    "FCO": "Roma", "LHR": "Londra", "ATH": "Atina Athina", "SVO": "Moskova Moskva",
    "VIE": "Viyana Wien", "MUC": "Münih München", "CGN": "Köln", "GVA": "Cenevre Genève",
    "ZRH": "Zürih Zürich", "BRU": "Brüksel Bruxelles Brussel", "LIS": "Lizbon Lisboa",
    "BCN": "Barselona", "SVQ": "Sevilla", "VLC": "Valensiya València", "MXP": "Milano",
    "VCE": "Venedik Venezia", "NAP": "Napoli", "FLR": "Floransa Firenze", "TRN": "Torino",
    "GOA": "Cenova Genova", "PRG": "Prag Praha", "BUD": "Budapeşte", "WAW": "Varşova Warszawa",
    "KRK": "Krakov Kraków", "OTP": "Bükreş București", "SOF": "Sofya", "BEG": "Belgrad Beograd",
    "SKG": "Selanik Thessaloniki", "CPH": "Kopenhag København", "ARN": "Stokholm",
    "KEF": "İzlanda Iceland", "LED": "Petersburg Sankt-Peterburg",
    "MRS": "Marsilya", "NCE": "Nis", "SJJ": "Saraybosna", "TIA": "Tiran", "SKP": "Üsküp",
    "PRN": "Priştine", "RMO": "Kişinev Chișinău", "LCA": "Larnaka", "MLA": "Valletta",
    "DUS": "Duesseldorf", "NUE": "Nürnberg Nuremberg", "LYS": "Lyon",
    # Caucasus, Central Asia, Middle East, Africa
    "TBS": "Tiflis", "GYD": "Bakü", "EVN": "Erivan", "TAS": "Taşkent", "ALA": "Almatı",
    "BSZ": "Bişkek", "CAI": "Kahire", "AUH": "Abu Dabi", "RUH": "Riyad", "JED": "Cidde",
    "MED": "Medine Madinah", "BEY": "Beyrut", "TUN": "Tunus", "ALG": "Cezayir",
    "CMN": "Kazablanka", "RAK": "Marakeş", "TLV": "Telaviv", "AMM": "Amman",
    # Asia, Americas, Oceania
    "SIN": "Singapur", "PEK": "Pekin", "PVG": "Şanghay", "ICN": "Seul", "DEL": "Yeni Delhi",
    "BOM": "Bombay", "MLE": "Maldivler", "JFK": "Nevyork NYC", "MEX": "Meksiko Ciudad de México",
    "SYD": "Sidney", "GRU": "São Paulo",
}
