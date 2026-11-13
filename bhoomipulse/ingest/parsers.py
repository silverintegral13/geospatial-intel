"""Portal parsers that work on pages or notices YOU have saved or fetched politely.

1. parse_notice()      bank e-auction sale notices (BAANKNET / SARFAESI wording): reserve price,
                       EMD, auction date, area with unit conversion, bank, asset type, possession,
                       district. Label-driven, so it does not depend on one site's HTML layout.
2. link_relistings()   groups repeat notices for the same property into rounds (re-listing history).
3. parse_html_tables() pulls tables out of a saved page and maps headers to our CSV templates
                       (jantri rates, RERA projects, district credit) through header aliases.

HONEST STATUS: the portals could not be opened from the build environment. The notice parser
follows the field wording seen in public listings of BAANKNET auctions and is tested on fixtures
written for this repo, not on live portal pages. Check the first few real results by eye.
"""
from __future__ import annotations

import hashlib
import re
from html.parser import HTMLParser

import pandas as pd

BANKS = ["State Bank of India", "Bank of Baroda", "Punjab National Bank", "Canara Bank", "Union Bank of India", "Bank of India",
         "Indian Bank", "Central Bank of India", "Indian Overseas Bank", "UCO Bank", "Bank of Maharashtra", "Punjab & Sind Bank",
         "Punjab and Sind Bank", "Axis Bank", "ICICI Bank", "HDFC Bank", "IDBI Bank", "Karnataka Bank", "Kotak Mahindra Bank"]
# spelling in notices -> district name used in our boundary file
DISTRICT_ALIASES = {
    "ahmedabad": "Ahmadabad", "ahmadabad": "Ahmadabad", "amreli": "Amreli", "anand": "Anand", "aravalli": "Aravali", "aravali": "Aravali",
    "banaskantha": "Banas Kantha", "banas kantha": "Banas Kantha", "vav-tharad": "Banas Kantha", "tharad": "Banas Kantha",
    "botad": "Batod", "bharuch": "Bharuch", "bhavnagar": "Bhavnagar", "chhota udepur": "Chhota Udaipur", "chhota udaipur": "Chhota Udaipur",
    "devbhoomi dwarka": "Devbhumi Dwarka", "devbhumi dwarka": "Devbhumi Dwarka", "dahod": "Dohad", "dohad": "Dohad",
    "gandhinagar": "Gandhinagar", "gir somnath": "Gir Somnath", "jamnagar": "Jamnagar", "junagadh": "Junagadh", "kutch": "Kachchh",
    "kachchh": "Kachchh", "bhuj": "Kachchh", "kheda": "Kheda", "nadiad": "Kheda", "mehsana": "Mahesana", "mahesana": "Mahesana",
    "mahisagar": "Mahisagar", "morbi": "Morbi", "narmada": "Narmada", "navsari": "Navsari", "panchmahal": "Panch Mahals",
    "panch mahals": "Panch Mahals", "godhra": "Panch Mahals", "patan": "Patan", "porbandar": "Porbandar", "rajkot": "Rajkot",
    "sabarkantha": "Sabar Kantha", "sabar kantha": "Sabar Kantha", "himatnagar": "Sabar Kantha", "surat": "Surat",
    "surendranagar": "Surendranagar", "tapi": "Tapi", "dang": "The Dangs", "vadodara": "Vadodara", "baroda district": "Vadodara",
    "valsad": "Valsad", "vapi": "Valsad", "sanand": "Ahmadabad",
}
# unit -> square metres. Local units (bigha / vigha) vary by district and are NOT converted.
UNITS = [
    (r"sq\.?\s*(?:ft|feet|foot)\.?|sqft|square\s*(?:feet|foot)", 0.092903),
    (r"sq\.?\s*(?:m|mt|mtr|mtrs|meter|meters|metre|metres)\.?|sqm|square\s*met(?:er|re)s?", 1.0),
    (r"sq\.?\s*(?:yd|yds|yard|yards)\.?|square\s*yards?|gaj", 0.836127),
    (r"acres?", 4046.86), (r"hectares?|ha\b", 10000.0), (r"ares?\b", 100.0), (r"gunthas?", 101.17), (r"marlas?", 25.2929),
]
_NUM = r"([\d,]+(?:\.\d+)?)"
_MONEY = re.compile(r"(?:₹|rs\.?|inr)?\s*" + _NUM + r"\s*(crores?|cr\b|lakhs?|lacs?)?", re.I)
_DATE = re.compile(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})")
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        if tag in ("br", "p", "div", "tr", "li", "h1", "h2", "h3", "td", "th"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(html: str) -> str:
    p = _Text()
    p.feed(html)
    return re.sub(r"[ \t\xa0]+", " ", "".join(p.out))


def _money_after(label: str, text: str) -> float | None:
    m = re.search("(?:" + label + r")[^\d₹\n]{0,40}\n?[^\d₹\n]{0,10}", text, re.I)
    if not m:
        return None
    v = _MONEY.match(text, m.end())
    if not v:
        return None
    x = float(v.group(1).replace(",", ""))
    unit = (v.group(2) or "").lower()
    return x * (1e7 if unit.startswith("cr") else 1e5 if unit.startswith("la") else 1)


def _date(m: re.Match) -> str | None:
    try:
        if m.group(1):
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:
            d, mo, y = int(m.group(4)), _MONTHS[m.group(5)[:3].lower()], int(m.group(6))
        return pd.Timestamp(year=y, month=mo, day=d).strftime("%Y-%m-%d")
    except (KeyError, ValueError):
        return None


def _date_after(label: str, text: str) -> str | None:
    for m in re.finditer("(?:" + label + r")[^\n]{0,60}\n?[^\n]{0,30}", text, re.I):
        d = _DATE.search(m.group(0))
        if d and _date(d):
            return _date(d)
    return None


def parse_area(text: str) -> tuple[float | None, str | None]:
    """First area with a recognised unit, in sq m. Returns (None, raw) when the unit is local (bigha, vigha)."""
    for pat, k in UNITS:
        m = re.search(_NUM + r"\s*(?:" + pat + r")", text, re.I)
        if m:
            return round(float(m.group(1).replace(",", "")) * k, 1), m.group(0)
    m = re.search(_NUM + r"\s*(?:bighas?|vighas?)", text, re.I)
    return (None, m.group(0)) if m else (None, None)


def classify_asset(text: str) -> str | None:
    t = text.lower()
    stated = re.search(r"property\s*type\s*[:-]?\s*([^\n]{3,60})", t)        # trust the notice's own type line first
    if stated and classify_asset(stated.group(1).replace("property type", "")):
        return classify_asset(stated.group(1).replace("property type", ""))
    if re.search(r"agricultur|farm\s*land|khet", t):
        return "agri_land"
    if re.search(r"factory|industrial|\bshed\b|godown|warehouse|gidc|plant\s*(?:and|&)\s*machinery", t):
        return "industrial"
    if re.search(r"\bshop\b|office\s*(?:space|premises|unit|no)|commercial|showroom", t):
        return "commercial"
    if re.search(r"residential\s*plot|open\s*plot|\bn\.?a\.?\s*(?:land|plot)|non[- ]agricultural", t):
        return "plot_na"
    if re.search(r"flat|house|apartment|bungalow|tenement|villa|residential|duplex|row\s*house", t):
        return "residential"
    if re.search(r"\bplot\b|\bland\b", t):
        return "plot_na"
    return None


def find_district(text: str) -> str | None:
    t = text.lower()
    hits = [(t.find(k), v) for k, v in DISTRICT_ALIASES.items() if re.search(r"\b" + re.escape(k) + r"\b", t)]
    hits = [h for h in hits if h[1] != "Ahmadabad" or "sanand" in t or "ahmedabad" in t or "ahmadabad" in t]
    return min(hits)[1] if hits else None


def parse_notice(text: str, source: str = "") -> dict:
    """One sale notice (plain text, or HTML which is stripped first) -> one listing row.
    Fields the notice does not state stay None; nothing is guessed."""
    if "<" in text and re.search(r"<\s*(html|div|table|p|br)\b", text, re.I):
        text = html_to_text(text)
    text = text.replace("\r", "")
    pid = re.search(r"property\s*id\s*[:#-]?\s*([A-Za-z0-9/-]{4,})", text, re.I)
    area, area_raw = parse_area(text)
    reserve = _money_after(r"reserve\s*price", text)
    emd = _money_after(r"EMD(?:\s*(?:required|amount))?|earnest\s*money(?:\s*deposit)?", text)
    date = (_date_after(r"(?:date\s*(?:and|&)\s*time\s*of\s*(?:e-?)?auction|(?:e-?)?auction\s*date|date\s*of\s*(?:e-?)?auction|\bstart\b)", text)
            or _date_after(r"\bend\b", text))
    bank = next((b for b in BANKS if b.lower() in text.lower()), None)
    poss = re.search(r"\b(symbolic|physical)\b", text, re.I)
    loc = re.search(r"(?:located\s*at|situated\s*at|address|property\s*(?:details|description))\s*[:-]?\s*([^\n]{8,200})", text, re.I)
    row = {"property_id": pid.group(1) if pid else None, "bank": "Punjab & Sind Bank" if bank == "Punjab and Sind Bank" else bank,
           "asset_type": classify_asset(text), "district": find_district(text), "address_text": loc.group(1).strip() if loc else None,
           "area_sqm": area, "area_raw": area_raw, "reserve_price": reserve, "emd": emd,
           "bid_increment": _money_after(r"bid\s*increment", text), "auction_date": date,
           "possession": poss.group(1).lower() if poss else None, "source": source}
    need = ["asset_type", "district", "area_sqm", "reserve_price", "auction_date"]
    row["missing"] = ",".join(k for k in need if row[k] is None)
    return row


def _key(r: pd.Series) -> str:
    if isinstance(r.property_id, str) and r.property_id:
        return f"ID:{r.property_id}"
    addr = re.sub(r"[^a-z0-9]+", " ", (r.address_text or "").lower()).split()[:8]
    raw = "|".join([str(r.bank), str(r.district), str(r.asset_type), str(round(r.area_sqm or 0)), " ".join(addr)])
    return "H:" + hashlib.sha1(raw.encode()).hexdigest()[:12]


def link_relistings(notices: pd.DataFrame, gazetteer: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Notices -> (listings in the baanknet_listings template layout, rounds).

    Notices for the same property (same property id, else same bank + district + type + area +
    address words) become rounds ordered by auction date. A sale notice never says whether the
    auction succeeded, so `sold` and `final_price` are left empty for you to fill.
    """
    n = notices.copy()
    n["key"] = n.apply(_key, axis=1)
    n = n.sort_values(["key", "auction_date"])
    n["round"] = n.groupby("key").cumcount() + 1
    g = n.groupby("key")
    first, last = g.first(), g.last()
    L = pd.DataFrame({
        "listing_id": [k.replace("ID:", "").replace("H:", "N-") for k in first.index], "bank": first.bank.to_numpy(),
        "asset_type": first.asset_type.to_numpy(), "district": first.district.to_numpy(), "locality": None,
        "address_text": first.address_text.to_numpy(), "lat": None, "lon": None, "geocode_confidence": None,
        "area_sqm": first.area_sqm.to_numpy(), "reserve_first": first.reserve_price.to_numpy(), "reserve_last": last.reserve_price.to_numpy(),
        "emd": last.emd.to_numpy(),
        "listed_date": (pd.to_datetime(first.auction_date) - pd.Timedelta(days=30)).dt.strftime("%Y-%m-%d").to_numpy(),
        "last_auction_date": last.auction_date.to_numpy(), "n_rounds": g.size().to_numpy(), "sold": None, "final_price": None})
    if gazetteer is not None:      # coarse geocode: district centre, confidence 0.5
        gz = gazetteer.set_index("district")
        ok = L.district.isin(gz.index)
        L.loc[ok, "lat"] = L.district[ok].map(gz.lat).to_numpy()
        L.loc[ok, "lon"] = L.district[ok].map(gz.lon).to_numpy()
        L.loc[ok, "geocode_confidence"] = 0.5
    R = n[["key", "round", "auction_date", "reserve_price", "source"]].rename(columns={"key": "listing_key"})
    return L, R


# --------------------------------------------------------------- HTML tables
class _Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.row, self.cell, self.depth = [], None, None, 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
            self.tables.append([])
        elif tag == "tr" and self.depth:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag == "table":
            self.depth -= 1
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.tables[-1].append(self.row)
            self.row = None
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append(re.sub(r"\s+", " ", "".join(self.cell)).strip())
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


# template column -> header words that may appear on a saved page (lower case; first match wins)
HEADER_ALIASES = {
    "jantri": {"village": ["village", "gam", "ગામ"], "survey_number_or_zone": ["survey", "zone", "value zone", "સર્વે"],
               "land_use": ["land use", "type", "category", "પ્રકાર"], "rate_rs_per_sqm": ["rate", "jantri", "sq.mt", "sq. mt", "ભાવ"],
               "effective_date": ["effective", "date"]},
    "rera_projects": {"rera_id": ["registration no", "rera no", "rera id"], "project": ["project name", "project"], "district": ["district"],
                      "status": ["status"], "quarter": ["quarter"], "percent_complete": ["% complet", "percent", "progress"]},
    "district_credit": {"district": ["district"], "fy": ["year", "fy"], "npa_ratio_pct": ["npa %", "npa ratio", "% npa", "gross npa"],
                        "agri_share_credit": ["agri share", "agriculture share"], "source_document": ["source"]},
}


def parse_html_tables(html: str, template: str, min_cols: int = 2) -> pd.DataFrame:
    """Largest table on a saved page whose headers match the template's aliases, as a DataFrame in template layout.
    Columns with no matching header are left empty. Raises if no table matches at least `min_cols` columns."""
    p = _Tables()
    p.feed(html)
    aliases, best = HEADER_ALIASES[template], None
    for t in p.tables:
        if len(t) < 2:
            continue
        head = [h.lower() for h in t[0]]
        cols = {}
        for target, words in aliases.items():
            for i, h in enumerate(head):
                if i not in cols.values() and any(w in h for w in words):
                    cols[target] = i
                    break
        if len(cols) >= min_cols and (best is None or len(t) > len(best[0])):
            best = (t, cols)
    if best is None:
        raise ValueError(f"no table with at least {min_cols} recognisable '{template}' columns; check HEADER_ALIASES")
    t, cols = best
    df = pd.DataFrame({k: [r[i] if i < len(r) else None for r in t[1:]] if (i := cols.get(k)) is not None else None for k in aliases})
    for c in ("rate_rs_per_sqm", "percent_complete", "npa_ratio_pct", "agri_share_credit"):
        if c in df and df[c].notna().any():
            df[c] = pd.to_numeric(df[c].astype(str).str.replace(r"[^\d.]", "", regex=True), errors="coerce")
    return df.dropna(how="all")
