#!/usr/bin/env python3
"""Piaci áttekintő adatlekérés.

Ingyenes, kulcs nélküli forrásokból tölti le az árakat, a hangulatot, a szektorokat
és a napi híreket, kiszámolja a piaci szélességet, a kereskedési pontszámot és a
Nasdaq trendszűrőt, majd a web/data/dashboard.json fájlba ír.
Ha egy forrás elbukik, a korábbi jó értéket megtartja és stale jelzéssel látja el.
Egy forrás hibája nem állítja meg a többit.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import re
import time
import traceback
import warnings
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

warnings.filterwarnings("ignore")
logging.getLogger("yfinance").setLevel(logging.CRITICAL)
logging.getLogger("peewee").setLevel(logging.CRITICAL)
logging.getLogger("urllib3").setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
DATA_PATH = ROOT / "web" / "data" / "dashboard.json"
BUDAPEST = ZoneInfo("Europe/Budapest")

PRICE_PERIOD = "3y"
BATCH_SIZE = 40
SCHEMA_VERSION = 1

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
WIKI_UA = "PiaciAttekinto/1.0 (static market dashboard; educational)"

SPX_WIKI = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
NDX_WIKI = "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies"
CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2023-11-01"
AAII_URL = "https://www.aaii.com/sentimentsurvey"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd=2016-01-01"
# A FRED élhálózata a böngészős és a hosszú egyedi User-Agentet válasz nélkül hagyja
# (a kapcsolat megnyílik, a törzs nem érkezik meg, ezért read timeout). Egy rövid,
# nem böngészős azonosítóval a nyilvános CSV azonnal megjön, API-kulcs nélkül.
FRED_HEADERS = {"User-Agent": "FREDGraph/1.0", "Accept": "text/csv,text/plain,*/*"}
TREASURY_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
    "&field_tdr_date_value={year}&page&_format=csv"
)
BSE_PAGE = "https://bse.hu/pages/data-download"

MONTHS_HU = [
    "január",
    "február",
    "március",
    "április",
    "május",
    "június",
    "július",
    "augusztus",
    "szeptember",
    "október",
    "november",
    "december",
]

RATING_HU = {
    "extreme fear": "extrém félelem",
    "fear": "félelem",
    "neutral": "semleges",
    "greed": "kapzsiság",
    "extreme greed": "extrém kapzsiság",
}

INDICES = [
    {"id": "spx", "name": "S&P 500", "ticker": "^GSPC", "digits": 2, "group": "usa"},
    {"id": "ndx", "name": "Nasdaq-100", "ticker": "^NDX", "digits": 2, "group": "usa"},
    {"id": "ixic", "name": "Nasdaq Composite", "ticker": "^IXIC", "digits": 2, "group": "usa"},
    {"id": "dji", "name": "Dow Jones", "ticker": "^DJI", "digits": 2, "group": "usa"},
    {"id": "rut", "name": "Russell 2000", "ticker": "^RUT", "digits": 2, "group": "usa"},
    {"id": "dax", "name": "DAX", "ticker": "^GDAXI", "digits": 2, "group": "eu"},
]

EXTRAS = [
    {"id": "dxy", "name": "Dollárindex", "ticker": "DX-Y.NYB", "digits": 2, "unit": "index"},
    {"id": "gold", "name": "Arany", "ticker": "GC=F", "digits": 2, "unit": "USD/uncia"},
    {"id": "oil", "name": "WTI olaj", "ticker": "CL=F", "digits": 2, "unit": "USD/hordó"},
    {"id": "btc", "name": "Bitcoin", "ticker": "BTC-USD", "digits": 0, "unit": "USD"},
]

# Az S&P 500 tizenegy GICS szektora, SPDR ETF-eken. A heti hozam 5 kereskedési nap.
SECTORS = [
    {"id": "xlk", "ticker": "XLK", "name": "Technológia", "name_en": "Technology"},
    {"id": "xlf", "ticker": "XLF", "name": "Pénzügy", "name_en": "Financials"},
    {"id": "xlv", "ticker": "XLV", "name": "Egészségügy", "name_en": "Health Care"},
    {"id": "xly", "ticker": "XLY", "name": "Ciklikus fogyasztás", "name_en": "Consumer Discretionary"},
    {"id": "xlp", "ticker": "XLP", "name": "Alapvető fogyasztás", "name_en": "Consumer Staples"},
    {"id": "xle", "ticker": "XLE", "name": "Energia", "name_en": "Energy"},
    {"id": "xli", "ticker": "XLI", "name": "Ipar", "name_en": "Industrials"},
    {"id": "xlb", "ticker": "XLB", "name": "Alapanyag", "name_en": "Materials"},
    {"id": "xlu", "ticker": "XLU", "name": "Közmű", "name_en": "Utilities"},
    {"id": "xlre", "ticker": "XLRE", "name": "Ingatlan", "name_en": "Real Estate"},
    {"id": "xlc", "ticker": "XLC", "name": "Kommunikáció", "name_en": "Communication Services"},
]
BENCHMARK_TICKER = "SPY"
SECTOR_WEEK_SESSIONS = 5
SECTOR_MONTH_SESSIONS = 21

NEWS_WINDOW_HOURS = 36
NEWS_LIMIT = 12
NEWS_TARGET = 8
NEWS_PER_SOURCE = 3
NEWS_FEEDS = [
    {
        "id": "cnbc_top",
        "name": "CNBC",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
    },
    {
        "id": "cnbc_earnings",
        "name": "CNBC",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135",
    },
    {
        "id": "cnbc_economy",
        "name": "CNBC",
        "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
    },
    {
        "id": "marketwatch",
        "name": "MarketWatch",
        "url": "https://feeds.marketwatch.com/marketwatch/topstories/",
    },
    {
        "id": "yahoo",
        "name": "Yahoo Finance",
        "url": "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EDJI,%5EIXIC&region=US&lang=en-US",
    },
    {
        "id": "portfolio",
        "name": "Portfolio.hu",
        "url": "https://www.portfolio.hu/rss/all.xml",
    },
    {
        # A Reuters saját RSS-e 2026-ban kulcs nélkül nem elérhető (401 / megszűnt cím).
        # A Google News nyilvános RSS-e reuters.com-ra szűrve adja a címeket.
        "id": "reuters",
        "name": "Reuters",
        "url": (
            "https://news.google.com/rss/search?q=site:reuters.com+"
            "(stocks+OR+markets+OR+Fed+OR+oil+OR+yields)+when:2d&hl=en-US&gl=US&ceid=US:en"
        ),
    },
]
MARKET_RE = re.compile(
    r"\b(stocks?|markets?|s&p|nasdaq|dow|fed|federal|treasury|yields?|oil|gold|"
    r"banks?|earnings|futures|bonds?|inflation|economy|gdp|investors?|shares|"
    r"equit(?:y|ies)|tariffs?|rally|sell-?off|trading|recession|payrolls?|"
    r"bitcoin|crypto|etf|ipo|wall street)\b",
    re.IGNORECASE,
)
HU_MARKET_HINTS = (
    "tőzsde",
    "részvény",
    "hozam",
    "olaj",
    "forint",
    "mnb",
    "kamat",
    "inflác",
    "befektet",
    "arany",
    "dollár",
    "árfolyam",
    "kötvény",
    "bitcoin",
    "euró",
)

VIX_TICKERS = {"vix": "^VIX", "vix9d": "^VIX9D", "vix3m": "^VIX3M"}

YIELD_SERIES = [
    ("m3", "DGS3MO", "3 hónap"),
    ("y2", "DGS2", "2 év"),
    ("y10", "DGS10", "10 év"),
    ("y30", "DGS30", "30 év"),
    ("spread", "T10Y2Y", "10 év − 2 év"),
]

LIMITS = {
    "breadth": 1400,
    "daily": 900,
    "yields": 1400,
    "aaii": 600,
    "cnn": 800,
}

# Kereskedési pontszám: trendkövető long swing, nem kontrariánus jelzés.
# Minden részpont 0–100. Hiányzó résznél a súlyok a többire normálódnak.
SCORE_PARTS = (
    ("nasdaq", "Nasdaq-trend", 35),
    ("breadth", "Piaci szélesség", 25),
    ("volatility", "Volatilitás", 20),
    ("credit", "Hitelkockázat", 10),
    ("sentiment", "Hangulat", 10),
)
SCORE_META = {item[0]: item for item in SCORE_PARTS}
SCORE_HISTORY_DAYS = 60
FRESH_CROSS_DAYS = 5
FRESH_CROSS_BONUS = 10.0
VIX_INVERSION_PENALTY = 20.0
COMPONENT_MAX_AGE_DAYS = 12
BREADTH_FIELDS = (
    ("spx50", "S&P 500 50 napos"),
    ("spx200", "S&P 500 200 napos"),
    ("ndx50", "Nasdaq-100 50 napos"),
    ("ndx200", "Nasdaq-100 200 napos"),
)
SCORE_METHOD = (
    "Trendkövető long swing környezetet mér, nem kontrariánus jelzés. "
    "Súlyozott átlag, minden rész 0–100: Nasdaq-trend 35%, "
    "piaci szélesség 25%, volatilitás 20%, hitelkockázat 10%, hangulat 10%. "
    "Ha egy rész hiányzik, a súlyok a többire normálódnak; az extrém félelem rontja a pontot."
)


def log(message: str) -> None:
    print(message, flush=True)


def http_session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = WIKI_UA
    return session


def date_str(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def rnd(value, digits: int = 2):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(number):
        return None
    return round(number, digits)


def chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def load_previous() -> dict:
    if not DATA_PATH.exists():
        return {}
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log(f"A korábbi dashboard.json nem olvasható ({exc}), üres állapotból indulunk.")
        return {}
    if data.get("meta", {}).get("schema_version") not in (None, SCHEMA_VERSION):
        log("A korábbi fájl sémája eltér, az előzményt nem használjuk.")
        return {}
    return data


def write_dashboard(payload: dict) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    tmp = DATA_PATH.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(DATA_PATH)


def has_payload(block) -> bool:
    if not isinstance(block, dict):
        return False
    if block.get("history") or block.get("items") or block.get("sectors"):
        return True
    for key in ("value", "price", "score", "bull", "vix", "close"):
        if block.get(key) is not None:
            return True
    current = block.get("current")
    return isinstance(current, dict) and any(v is not None for v in current.values())


def as_stale(previous, error: str, empty: dict) -> dict:
    message = str(error).strip().splitlines()[-1][:300]
    if has_payload(previous):
        stale = json.loads(json.dumps(previous))
        stale["status"] = "stale"
        stale["error"] = message
        return stale
    result = dict(empty)
    result["status"] = "unavailable"
    result["error"] = message
    return result


def merge_rows(old_rows, new_rows, limit: int) -> list:
    merged: dict[str, dict] = {}
    for row in old_rows or []:
        if isinstance(row, dict) and row.get("date"):
            merged[row["date"]] = dict(row)
    for row in new_rows or []:
        if not isinstance(row, dict) or not row.get("date"):
            continue
        combined = dict(merged.get(row["date"], {}))
        for key, value in row.items():
            if value is not None:
                combined[key] = value
        merged[row["date"]] = combined
    rows = [merged[key] for key in sorted(merged)]
    if limit and len(rows) > limit:
        rows = rows[-limit:]
    return rows


def budapest_stamp(now: datetime) -> str:
    return f"{now.year}. {MONTHS_HU[now.month - 1]} {now.day}., {now:%H:%M}"


def clean_symbol(raw) -> str:
    text = str(raw).strip().upper().replace(".", "-")
    text = re.sub(r"[^A-Z0-9\-]", "", text)
    return text


def read_constituents(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    result = []
    for row in rows:
        symbol = clean_symbol(row.get("symbol", ""))
        if symbol:
            result.append({"symbol": symbol, "name": (row.get("name") or "").strip()})
    return result


def write_constituents(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["symbol", "name"])
        writer.writeheader()
        for row in rows:
            writer.writerow({"symbol": row["symbol"], "name": row["name"]})


def column_named(frame: pd.DataFrame, options: set[str]):
    for column in frame.columns:
        label = str(column).split("[")[0].strip().lower()
        if label in options:
            return column
    return None


def table_to_constituents(frame: pd.DataFrame, symbol_names: set[str], name_names: set[str]) -> list[dict]:
    if isinstance(frame.columns, pd.MultiIndex):
        frame = frame.copy()
        frame.columns = [str(col[0]) for col in frame.columns]
    symbol_col = column_named(frame, symbol_names)
    name_col = column_named(frame, name_names)
    if symbol_col is None:
        return []
    rows = []
    seen = set()
    for _, record in frame.iterrows():
        symbol = clean_symbol(record[symbol_col])
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        name = ""
        if name_col is not None and pd.notna(record[name_col]):
            name = str(record[name_col]).strip()
        rows.append({"symbol": symbol, "name": name})
    return rows


def fetch_wiki_table(session: requests.Session, url: str) -> list[pd.DataFrame]:
    response = session.get(url, headers={"User-Agent": WIKI_UA}, timeout=40)
    response.raise_for_status()
    return pd.read_html(io.StringIO(response.text))


def load_universe(session: requests.Session, kind: str) -> tuple[list[dict], str]:
    spec = {
        "sp500": {
            "url": SPX_WIKI,
            "path": CACHE / "sp500.csv",
            "symbols": {"symbol"},
            "names": {"security", "company"},
            "minimum": 450,
        },
        "nasdaq100": {
            "url": NDX_WIKI,
            "path": CACHE / "nasdaq100.csv",
            "symbols": {"ticker", "symbol"},
            "names": {"company", "security"},
            "minimum": 95,
        },
    }[kind]
    cached = read_constituents(spec["path"])
    try:
        tables = fetch_wiki_table(session, spec["url"])
        best: list[dict] = []
        for table in tables:
            rows = table_to_constituents(table, spec["symbols"], spec["names"])
            if len(rows) > len(best):
                best = rows
        if len(best) < spec["minimum"]:
            raise RuntimeError(f"a Wikipedia-tábla túl rövid ({len(best)})")
        write_constituents(spec["path"], best)
        log(f"{kind}: {len(best)} összetevő a Wikipédiáról.")
        return best, "wikipedia"
    except Exception as exc:
        if len(cached) >= spec["minimum"]:
            log(f"{kind}: Wikipedia hiba ({exc}); gyorsítótár, {len(cached)} összetevő.")
            return cached, "cache"
        raise RuntimeError(f"{kind} összetevőlista nem elérhető: {exc}") from exc


def extract_close(frame: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    if frame is None or frame.empty:
        raise RuntimeError("üres árfolyamválasz")
    if isinstance(frame.columns, pd.MultiIndex):
        levels = frame.columns.get_level_values(0)
        if "Close" in levels:
            close = frame["Close"]
        elif "Close" in frame.columns.get_level_values(1):
            close = frame.xs("Close", axis=1, level=1)
        else:
            raise RuntimeError("nincs Close oszlop")
    else:
        if "Close" not in frame.columns:
            raise RuntimeError("nincs Close oszlop")
        close = frame[["Close"]].rename(columns={"Close": tickers[0]})
    if isinstance(close, pd.Series):
        close = close.to_frame(name=tickers[0])
    close = close.loc[:, ~close.columns.duplicated()]
    return close


def fetch_chunk(tickers: list[str], period: str) -> pd.DataFrame:
    frame = yf.download(
        tickers,
        period=period,
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=True,
        group_by="column",
    )
    close = extract_close(frame, tickers)
    if int(close.notna().sum().sum()) == 0:
        raise RuntimeError("csupa üres záróár")
    return close


def download_closes(tickers: list[str], period: str) -> pd.DataFrame:
    unique = list(dict.fromkeys(tickers))
    frames = []
    pending = unique
    for round_index in range(3):
        if not pending:
            break
        failed: list[str] = []
        for chunk in chunks(pending, BATCH_SIZE):
            try:
                close = fetch_chunk(chunk, period)
                good = [column for column in close.columns if close[column].notna().any()]
                if good:
                    frames.append(close[good])
                missing = [ticker for ticker in chunk if ticker not in set(map(str, good))]
                failed.extend(missing)
                log(f"  árfolyam {len(good)}/{len(chunk)}" + (f", hiányzik {len(missing)}" if missing else ""))
            except Exception as exc:
                log(f"  köteg hiba ({chunk[0]}…): {exc}")
                failed.extend(chunk)
            time.sleep(0.3)
        pending = failed
        if pending and round_index < 2:
            log(f"Újrapróbálás {len(pending)} tickeren.")
            time.sleep(1.5 * (round_index + 1))
    if not frames:
        raise RuntimeError("egyetlen záróár sem jött le")
    combined = pd.concat(frames, axis=1)
    combined = combined.loc[:, ~combined.columns.duplicated()]
    combined = combined.dropna(axis=1, how="all").sort_index()
    return combined


def series_history(series: pd.Series, digits: int = 2) -> list[dict]:
    clean = series.dropna()
    return [{"date": date_str(idx), "close": rnd(value, digits)} for idx, value in clean.items()]


def quote_from_series(meta: dict, series: pd.Series, source: str) -> dict:
    clean = series.dropna()
    if len(clean) < 5:
        raise RuntimeError(f"kevés ár ({len(clean)})")
    price = float(clean.iloc[-1])
    previous = float(clean.iloc[-2]) if len(clean) > 1 else None
    change = price - previous if previous is not None else None
    change_pct = (change / previous * 100) if previous not in (None, 0) else None
    ma50 = float(clean.rolling(50).mean().iloc[-1]) if len(clean) >= 50 else None
    ma200 = float(clean.rolling(200).mean().iloc[-1]) if len(clean) >= 200 else None
    digits = int(meta.get("digits", 2))
    history = series_history(clean, digits)
    return {
        "status": "ok",
        "id": meta["id"],
        "name": meta["name"],
        "ticker": meta["ticker"],
        "digits": digits,
        "unit": meta.get("unit", ""),
        "group": meta.get("group", ""),
        "source": source,
        "as_of": history[-1]["date"],
        "price": rnd(price, digits),
        "change": rnd(change, digits),
        "change_pct": rnd(change_pct, 2),
        "dma50": rnd(ma50, digits),
        "dma200": rnd(ma200, digits),
        "dist50_pct": rnd((price / ma50 - 1) * 100, 2) if ma50 else None,
        "dist200_pct": rnd((price / ma200 - 1) * 100, 2) if ma200 else None,
        "history": history,
    }


def empty_quote(meta: dict, source: str) -> dict:
    return {
        "id": meta["id"],
        "name": meta["name"],
        "ticker": meta["ticker"],
        "digits": meta.get("digits", 2),
        "unit": meta.get("unit", ""),
        "group": meta.get("group", ""),
        "source": source,
        "as_of": None,
        "price": None,
        "change": None,
        "change_pct": None,
        "dma50": None,
        "dma200": None,
        "dist50_pct": None,
        "dist200_pct": None,
        "history": [],
    }


def breadth_frame(closes: pd.DataFrame, minimum: int) -> pd.DataFrame:
    result = pd.DataFrame(index=closes.index)
    for window, prefix in ((50, "p50"), (200, "p200")):
        average = closes.rolling(window, min_periods=window).mean()
        valid = closes.notna() & average.notna()
        above = (closes > average) & valid
        count = valid.sum(axis=1)
        percent = above.sum(axis=1) / count.where(count > 0) * 100
        result[prefix] = percent.where(count >= minimum)
        result[f"n{window}"] = count.where(count >= minimum)
    return result


def build_breadth(spx: pd.DataFrame, ndx: pd.DataFrame, spx_n: int, ndx_n: int) -> dict:
    if spx.shape[1] < 400:
        raise RuntimeError(f"S&P 500-ból csak {spx.shape[1]} papír jött le")
    if ndx.shape[1] < 80:
        raise RuntimeError(f"Nasdaq-100-ból csak {ndx.shape[1]} papír jött le")
    spx_min = max(400, int(0.8 * spx.shape[1]))
    ndx_min = max(80, int(0.8 * ndx.shape[1]))
    spx_b = breadth_frame(spx, spx_min).rename(
        columns={"p50": "spx50", "p200": "spx200", "n50": "spx_n50", "n200": "spx_n200"}
    )
    ndx_b = breadth_frame(ndx, ndx_min).rename(
        columns={"p50": "ndx50", "p200": "ndx200", "n50": "ndx_n50", "n200": "ndx_n200"}
    )
    joined = spx_b.join(ndx_b, how="outer")
    usable = joined.dropna(subset=["spx200"])
    if usable.empty:
        raise RuntimeError("nincs 200 napos szélesség")
    history = []
    for idx, record in usable.iterrows():
        history.append(
            {
                "date": date_str(idx),
                "spx200": rnd(record.get("spx200"), 1),
                "spx50": rnd(record.get("spx50"), 1),
                "ndx200": rnd(record.get("ndx200"), 1),
                "ndx50": rnd(record.get("ndx50"), 1),
            }
        )
    last = usable.iloc[-1]
    return {
        "status": "ok",
        "source": "Saját számítás Yahoo Finance záróárakból; összetevők: Wikipedia",
        "as_of": history[-1]["date"],
        "universe": {"spx": spx_n, "ndx": ndx_n},
        "downloaded": {"spx": int(spx.shape[1]), "ndx": int(ndx.shape[1])},
        "current": {
            "spx200": rnd(last.get("spx200"), 1),
            "spx50": rnd(last.get("spx50"), 1),
            "ndx200": rnd(last.get("ndx200"), 1),
            "ndx50": rnd(last.get("ndx50"), 1),
            "spx_n": int(last["spx_n200"]) if pd.notna(last.get("spx_n200")) else None,
            "ndx_n": int(last["ndx_n200"]) if pd.notna(last.get("ndx_n200")) else None,
        },
        "history": history,
    }


def ms_to_date(value) -> str | None:
    try:
        stamp = pd.to_datetime(float(value), unit="ms", utc=True)
    except (TypeError, ValueError):
        return None
    return stamp.strftime("%Y-%m-%d")


def fetch_cnn(session: requests.Session) -> dict:
    response = session.get(
        CNN_URL,
        headers={
            "User-Agent": BROWSER_UA,
            "Accept": "application/json",
            "Referer": "https://edition.cnn.com/markets/fear-and-greed",
        },
        timeout=40,
    )
    response.raise_for_status()
    payload = response.json()
    fear = payload.get("fear_and_greed") or {}
    history_raw = (payload.get("fear_and_greed_historical") or {}).get("data") or []
    history = []
    for point in history_raw:
        day = ms_to_date(point.get("x"))
        score = rnd(point.get("y"), 1)
        if day and score is not None:
            history.append(
                {
                    "date": day,
                    "score": score,
                    "rating": point.get("rating") or "",
                }
            )
    history = merge_rows([], history, LIMITS["cnn"])
    score = rnd(fear.get("score"), 1)
    rating = (fear.get("rating") or "").strip().lower()
    if score is None and history:
        score = history[-1]["score"]
        rating = (history[-1].get("rating") or "").lower()
    if score is None or not (0 <= score <= 100):
        raise RuntimeError("a Fear & Greed érték hiányzik vagy érvénytelen")
    as_of = ms_to_date(pd.Timestamp(fear["timestamp"]).value // 10**6) if fear.get("timestamp") else None
    if as_of is None and history:
        as_of = history[-1]["date"]
    fear_block = {
        "status": "ok",
        "source": "CNN Fear & Greed",
        "as_of": as_of,
        "score": score,
        "rating": rating,
        "rating_hu": RATING_HU.get(rating, rating or "ismeretlen"),
        "previous_close": rnd(fear.get("previous_close"), 1),
        "previous_week": rnd(fear.get("previous_1_week"), 1),
        "previous_month": rnd(fear.get("previous_1_month"), 1),
        "previous_year": rnd(fear.get("previous_1_year"), 1),
        "history": history,
    }
    put_raw = (payload.get("put_call_options") or {}).get("data") or []
    put_history = []
    for point in put_raw:
        day = ms_to_date(point.get("x"))
        ratio = rnd(point.get("y"), 3)
        if day and ratio is not None:
            put_history.append({"date": day, "value": ratio})
    put_history = merge_rows([], put_history, LIMITS["cnn"])
    put_block = {
        "status": "ok",
        "source": "CNN Fear & Greed put/call komponens (CBOE részvényopció, 5 napos átlag)",
        "as_of": put_history[-1]["date"] if put_history else None,
        "value": put_history[-1]["value"] if put_history else None,
        "history": put_history,
    }
    if not put_history:
        put_block["status"] = "unavailable"
        put_block["error"] = "nincs put/call érték"
    else:
        recent = [row["value"] for row in put_history[-20:]]
        midpoint = sorted(recent)[len(recent) // 2]
        if not (0.2 <= midpoint <= 2.5):
            put_block = {
                "status": "unavailable",
                "source": put_block["source"],
                "value": None,
                "history": [],
                "error": f"a put/call sorozat nem aránynak tűnik (medián {midpoint})",
            }
    return {"fear_greed": fear_block, "put_call": put_block}


def fetch_aaii(session: requests.Session) -> dict:
    response = session.get(
        AAII_URL,
        headers={"User-Agent": BROWSER_UA, "Accept": "text/html"},
        timeout=40,
    )
    response.raise_for_status()
    html = response.text
    if "Bullish" not in html:
        raise RuntimeError("az AAII oldal nem tartalmazza a felmérést")
    matches = re.findall(
        r'<div class="date">(\d{1,2}/\d{1,2}/\d{4})</div>\s*<div class="bars">\s*'
        r'<div class="bar bullish"[^>]*>([\d.]+)%</div>\s*'
        r'<div class="bar neutral"[^>]*>([\d.]+)%</div>\s*'
        r'<div class="bar bearish"[^>]*>([\d.]+)%</div>',
        html,
    )
    if not matches:
        raise RuntimeError("az AAII heti tábla nem értelmezhető")
    history = []
    for raw_date, bull, neutral, bear in matches:
        parsed = datetime.strptime(raw_date, "%m/%d/%Y").date().isoformat()
        bull_v, neutral_v, bear_v = float(bull), float(neutral), float(bear)
        history.append(
            {
                "date": parsed,
                "bull": rnd(bull_v, 1),
                "neutral": rnd(neutral_v, 1),
                "bear": rnd(bear_v, 1),
                "spread": rnd(bull_v - bear_v, 1),
            }
        )
    history.sort(key=lambda row: row["date"])
    averages = None
    average_match = re.search(
        r"Historical Averages</div>\s*<div class=\"bars\">\s*"
        r"<div class=\"bar bullish\"[^>]*>([\d.]+)%</div>\s*"
        r"<div class=\"bar neutral\"[^>]*>([\d.]+)%</div>\s*"
        r"<div class=\"bar bearish\"[^>]*>([\d.]+)%</div>",
        html,
    )
    if average_match:
        averages = {
            "bull": float(average_match.group(1)),
            "neutral": float(average_match.group(2)),
            "bear": float(average_match.group(3)),
        }
    latest = history[-1]
    return {
        "status": "ok",
        "source": "AAII Investor Sentiment Survey, nyilvános heti eredmények",
        "as_of": latest["date"],
        "bull": latest["bull"],
        "neutral": latest["neutral"],
        "bear": latest["bear"],
        "spread": latest["spread"],
        "averages": averages,
        "history": history,
        "note": "A teljes, 1987-ig visszanyúló sorozat csak AAII-tagoknak érhető el. Az oldal a nyilvánosan kiírt heteket gyűjti.",
    }


def fetch_fred_series(session: requests.Session, series_id: str) -> pd.Series:
    url = FRED_URL.format(series_id=series_id)
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = session.get(url, headers=FRED_HEADERS, timeout=(10, 40))
            response.raise_for_status()
            text = response.text.lstrip("\ufeff")
            head = text[:120].lower()
            if "<html" in head or ("date" not in head and "observation_date" not in head):
                raise RuntimeError(f"{series_id} nem CSV választ adott")
            frame = pd.read_csv(io.StringIO(text))
            if frame.shape[1] < 2:
                raise RuntimeError(f"{series_id} CSV túl keskeny")
            frame.columns = ["date", "value", *list(frame.columns[2:])]
            frame = frame[["date", "value"]]
            frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
            frame = frame.dropna(subset=["value"])
            if frame.empty:
                raise RuntimeError(f"{series_id} üres")
            frame["date"] = pd.to_datetime(frame["date"])
            return frame.set_index("date")["value"].sort_index()
        except Exception as exc:
            last_error = exc
            log(f"  FRED {series_id} próba {attempt + 1} sikertelen: {exc}")
            time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(str(last_error))


def _treasury_column_map(frame: pd.DataFrame) -> dict[str, str]:
    found = {}
    for column in frame.columns:
        label = str(column).strip().lower()
        if label in {"3 mo", "3 month", "3 hónap"}:
            found["m3"] = column
        elif label in {"2 yr", "2 year", "2 év"}:
            found["y2"] = column
        elif label in {"10 yr", "10 year", "10 év"}:
            found["y10"] = column
        elif label in {"30 yr", "30 year", "30 év"}:
            found["y30"] = column
        elif label == "date":
            found["date"] = column
    return found


def build_treasury_yields(session: requests.Session) -> dict:
    frames = []
    year = date.today().year
    errors = []
    for current_year in range(year - 5, year + 1):
        try:
            response = session.get(
                TREASURY_URL.format(year=current_year),
                headers={"User-Agent": "data-fetch", "Accept": "text/csv,*/*"},
                timeout=(10, 30),
            )
            response.raise_for_status()
            text = response.text.lstrip("\ufeff")
            if "date" not in text[:80].lower():
                raise RuntimeError("nem CSV")
            frame = pd.read_csv(io.StringIO(text))
            if frame.empty:
                raise RuntimeError("üres")
            frames.append(frame)
            log(f"  Treasury {current_year}: {len(frame)} sor")
        except Exception as exc:
            errors.append(f"{current_year}: {exc}")
            log(f"  Treasury {current_year} hiba: {exc}")
    if not frames:
        raise RuntimeError("a Treasury hozamgörbe nem elérhető" + (f" ({errors[-1]})" if errors else ""))
    columns = _treasury_column_map(frames[0])
    required = ("date", "m3", "y2", "y10", "y30")
    if any(key not in columns for key in required):
        raise RuntimeError("a Treasury CSV oszlopai nem ismerhetők fel")
    history = []
    for frame in frames:
        mapped = _treasury_column_map(frame)
        if any(key not in mapped for key in required):
            continue
        for _, record in frame.iterrows():
            raw_date = record.get(mapped["date"])
            parsed = pd.to_datetime(raw_date, errors="coerce")
            if pd.isna(parsed):
                continue
            row = {"date": date_str(parsed)}
            for key in ("m3", "y2", "y10", "y30"):
                row[key] = rnd(record.get(mapped[key]), 2)
            if row.get("y10") is not None and row.get("y2") is not None:
                row["spread"] = rnd(row["y10"] - row["y2"], 2)
            else:
                row["spread"] = None
            if any(row[key] is not None for key in ("m3", "y2", "y10", "y30", "spread")):
                history.append(row)
    history = merge_rows([], history, 0)
    if not history:
        raise RuntimeError("nincs Treasury hozamadat")
    cutoff = (pd.Timestamp(history[-1]["date"]) - pd.Timedelta(days=365 * 5)).strftime("%Y-%m-%d")
    history = [row for row in history if row["date"] >= cutoff]
    if not history:
        raise RuntimeError("nincs Treasury hozamadat a megtartott ablakban")
    current = {}
    as_of = {}
    for key, _series_id, _label in YIELD_SERIES:
        filled = [(row["date"], row.get(key)) for row in history if row.get(key) is not None]
        current[key] = filled[-1][1] if filled else None
        as_of[key] = filled[-1][0] if filled else None
    return {
        "status": "ok",
        "source": "U.S. Treasury napi hozamgörbe (FRED helyett); a 10 év−2 év különbség saját számítás",
        "as_of": as_of.get("y10") or history[-1]["date"],
        "current": current,
        "as_of_by_tenor": as_of,
        "history": history,
        "fallback": "treasury",
    }


def build_yields(session: requests.Session) -> dict:
    series = {}
    for key, series_id, _label in YIELD_SERIES:
        series[key] = fetch_fred_series(session, series_id)
        log(f"  FRED {series_id}: {len(series[key])} pont, utolsó {date_str(series[key].index[-1])}")
    joined = pd.DataFrame(series).sort_index().dropna(how="all")
    cutoff = joined.index.max() - pd.Timedelta(days=365 * 5)
    joined = joined.loc[joined.index >= cutoff]
    history = []
    for idx, record in joined.iterrows():
        row = {"date": date_str(idx)}
        for key, _series_id, _label in YIELD_SERIES:
            row[key] = rnd(record.get(key), 2)
        if row.get("spread") is None and row.get("y10") is not None and row.get("y2") is not None:
            row["spread"] = rnd(row["y10"] - row["y2"], 2)
        if any(row[key] is not None for key, _a, _b in YIELD_SERIES):
            history.append(row)
    if not history:
        raise RuntimeError("nincs hozamadat")
    current = {}
    as_of = {}
    for key, _series_id, _label in YIELD_SERIES:
        filled = [(row["date"], row.get(key)) for row in history if row.get(key) is not None]
        current[key] = filled[-1][1] if filled else None
        as_of[key] = filled[-1][0] if filled else None
    yields = {
        "status": "ok",
        "source": "FRED: DGS3MO, DGS2, DGS10, DGS30, T10Y2Y",
        "as_of": as_of.get("y10") or history[-1]["date"],
        "current": current,
        "as_of_by_tenor": as_of,
        "history": history,
    }
    return yields


def build_hy_spread(session: requests.Session) -> dict:
    hy = fetch_fred_series(session, "BAMLH0A0HYM2")
    log(f"  FRED BAMLH0A0HYM2: {len(hy)} pont")
    hy_cut = hy.loc[hy.index >= hy.index.max() - pd.Timedelta(days=365 * 5)]
    hy_history = [{"date": date_str(idx), "value": rnd(value, 2)} for idx, value in hy_cut.items()]
    return {
        "status": "ok",
        "source": "FRED, ICE BofA US High Yield Index Option-Adjusted Spread (BAMLH0A0HYM2)",
        "as_of": hy_history[-1]["date"],
        "value": hy_history[-1]["value"],
        "history": hy_history,
    }


def bse_date(day: date) -> str:
    return f"{day.year:04d}.{day.month:02d}.{day.day:02d}."


def parse_bse_day(raw: str) -> str:
    text = raw.strip().strip(".")
    day, month, year = text.split(".")
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def fetch_bux(session: requests.Session) -> pd.Series:
    page = session.get(BSE_PAGE, headers={"User-Agent": BROWSER_UA}, timeout=40)
    page.raise_for_status()
    html = page.text
    csrf = re.search(r'name="_csrf" content="([^"]+)"', html)
    hist = re.search(r'historicalgenerator-url="([^"]+)"', html)
    last_url = re.search(r'lasttradeday-url="([^"]+)"', html)
    if not (csrf and hist and last_url):
        raise RuntimeError("a BÉT letöltőoldal szerkezete megváltozott")
    last = session.get("https://bse.hu" + last_url.group(1), timeout=30)
    last.raise_for_status()
    end_day = str(last.json()).strip()
    if not re.match(r"\d{4}\.\d{2}\.\d{2}\.", end_day):
        end_day = bse_date(date.today() - timedelta(days=1))
    end = datetime.strptime(end_day.strip("."), "%Y.%m.%d").date()
    start = bse_date(end - timedelta(days=1400))
    payload = {
        "startingValue": start,
        "endingValue": end_day if end_day.endswith(".") else end_day + ".",
        "resolution": "DAY_TO_DAY",
        "market": "INDEX",
        "format": "CSV",
        "type": "CLOSING",
        "currentCategory": "-1",
        "selectionList": [
            {"category": "Indexek", "selectedInstruments": [{"id": -1, "code": "BUX"}]}
        ],
    }
    response = session.post(
        "https://bse.hu" + hist.group(1) + "?_csrf=" + csrf.group(1),
        json=payload,
        headers={"User-Agent": BROWSER_UA},
        timeout=60,
    )
    response.raise_for_status()
    text = response.content.decode("utf-8-sig")
    sample = text.splitlines()[0] if text else ""
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        raise RuntimeError("üres BUX fájl")
    points = []
    for row in reader:
        raw_date = row.get("Date") or row.get("Dátum") or ""
        raw_price = row.get("Last price") or row.get("Záróár") or row.get("Close") or ""
        if not raw_date or not raw_price:
            values = list(row.values())
            if len(values) >= 3:
                raw_date, raw_price = values[1], values[2]
        try:
            points.append((parse_bse_day(raw_date), float(str(raw_price).replace(",", ".").replace(" ", ""))))
        except (TypeError, ValueError):
            continue
    if len(points) < 200:
        raise RuntimeError(f"a BUX sorozat túl rövid ({len(points)})")
    points.sort()
    index = pd.to_datetime([item[0] for item in points])
    return pd.Series([item[1] for item in points], index=index, name="BUX")


def build_vix_blocks(series_map: dict[str, pd.Series]) -> dict:
    vix = series_map.get("^VIX")
    if vix is None or vix.dropna().shape[0] < 5:
        raise RuntimeError("nincs VIX sorozat")
    vix_quote = quote_from_series(
        {"id": "vix", "name": "VIX", "ticker": "^VIX", "digits": 2},
        vix,
        "Yahoo Finance (^VIX)",
    )
    vix_block = {
        "status": "ok",
        "source": "Yahoo Finance (^VIX)",
        "as_of": vix_quote["as_of"],
        "value": vix_quote["price"],
        "change": vix_quote["change"],
        "change_pct": vix_quote["change_pct"],
        "history": [{"date": row["date"], "value": row["close"]} for row in vix_quote["history"]],
    }
    frames = {"vix": vix}
    for key, ticker in (("vix9d", "^VIX9D"), ("vix3m", "^VIX3M")):
        if ticker in series_map:
            frames[key] = series_map[ticker]
    if "vix3m" not in frames:
        raise RuntimeError("nincs VIX3M, a lejárati szerkezet hiányos")
    joined = pd.DataFrame(frames).dropna(how="all").sort_index()
    history = []
    for idx, record in joined.iterrows():
        row = {
            "date": date_str(idx),
            "vix9d": rnd(record.get("vix9d"), 2),
            "vix": rnd(record.get("vix"), 2),
            "vix3m": rnd(record.get("vix3m"), 2),
        }
        if any(row[key] is not None for key in ("vix9d", "vix", "vix3m")):
            history.append(row)
    latest = next(row for row in reversed(history) if row["vix"] is not None and row["vix3m"] is not None)
    ratio = latest["vix"] / latest["vix3m"] if latest["vix3m"] else None
    if ratio is None:
        structure = "unknown"
    elif ratio < 0.98:
        structure = "contango"
    elif ratio > 1.02:
        structure = "backwardation"
    else:
        structure = "flat"
    term = {
        "status": "ok",
        "source": "Yahoo Finance (^VIX9D, ^VIX, ^VIX3M)",
        "as_of": latest["date"],
        "vix9d": latest["vix9d"],
        "vix": latest["vix"],
        "vix3m": latest["vix3m"],
        "ratio": rnd(ratio, 3),
        "structure": structure,
        "history": history,
    }
    return {"vix": vix_block, "vix_term": term}


def round_half_up(value: float, digits: int = 0) -> float:
    quant = Decimal("1") if digits == 0 else Decimal("1").scaleb(-digits)
    rounded = Decimal(format(float(value), ".10f")).quantize(quant, rounding=ROUND_HALF_UP)
    return float(rounded)


def publish(value, digits: int):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    rounded = round_half_up(number, digits)
    return float(format(rounded, f".{digits}f"))


def hu_num(value, digits: int = 1, trim: bool = False) -> str:
    number = publish(value, digits)
    if number is None:
        return "–"
    sign = "−" if number < 0 else ""
    text = format(abs(number), f".{digits}f")
    whole, frac = (text.split(".") + [""])[:2]
    groups = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    body = "\u00a0".join(reversed(groups))
    if digits and not (trim and set(frac) <= {"0"}):
        if trim:
            frac = frac.rstrip("0")
        return f"{sign}{body},{frac}" if frac else f"{sign}{body}"
    return f"{sign}{body}"


def hu_signed(value, digits: int = 1, trim: bool = False) -> str:
    number = publish(value, digits)
    if number is None:
        return "–"
    if number > 0:
        return "+" + hu_num(number, digits, trim)
    return hu_num(number, digits, trim)


def hu_day(iso: str | None) -> str:
    if not iso:
        return "–"
    year, month, day = str(iso)[:10].split("-")
    return f"{year}. {month}. {day}."


def lerp_score(value: float, low: float, high: float, score_at_low: float, score_at_high: float) -> float:
    if high == low:
        return float(score_at_low)
    ratio = (float(value) - low) / (high - low)
    raw = score_at_low + ratio * (score_at_high - score_at_low)
    return max(0.0, min(100.0, raw))


def tone_for(score) -> str | None:
    if score is None:
        return None
    if score < 40:
        return "bad"
    if score < 60:
        return "warn"
    if score < 80:
        return "good"
    return "strong"


def band_for(score: int) -> dict:
    if score <= 39:
        return {"verdict": "Nem érdemes kereskedni", "tone": "bad"}
    if score <= 59:
        return {"verdict": "Óvatosan / fél kockázat", "tone": "warn"}
    if score <= 79:
        return {"verdict": "Kedvező", "tone": "good"}
    return {"verdict": "Erős piac", "tone": "strong"}


def classify_regime(close: float, ema9: float, ema20: float, sma50: float, sma200: float) -> dict:
    above9 = close > ema9
    above20 = close > ema20
    above50 = close > sma50
    above200 = close > sma200
    if close < ema20:
        return {"id": "none", "label": "Nincs kereskedés", "tone": "bad", "note": None, "reason": "below_ema20"}
    if (not above9) and above20:
        return {"id": "half", "label": "Fél kockázat", "tone": "warn", "note": None, "reason": "below_ema9"}
    if above9 and above20 and (not above50 or not above200):
        missing = []
        if not above50:
            missing.append("50 napos SMA")
        if not above200:
            missing.append("200 napos SMA")
        note = (
            "A záróár a 9 és a 20 napos EMA felett van, de a "
            + " és a ".join(missing)
            + " alatt."
        )
        return {"id": "half", "label": "Fél kockázat", "tone": "warn", "note": note, "reason": "below_long"}
    if above9 and above20 and above50 and above200:
        return {"id": "full", "label": "Teljes kockázat", "tone": "good", "note": None, "reason": "above_all"}
    if not above20:
        return {
            "id": "none",
            "label": "Nincs kereskedés",
            "tone": "bad",
            "note": "A záróár a 20 napos EMA-n van.",
            "reason": "touch_ema20",
        }
    if not above9:
        return {"id": "half", "label": "Fél kockázat", "tone": "warn", "note": None, "reason": "touch_ema9"}
    note = (
        "A záróár a 9 és a 20 napos EMA felett van, de a hosszabb távú mozgóátlagot "
        "(50 vagy 200 napos SMA) érinti, ezért nem teljes kockázat."
    )
    return {"id": "half", "label": "Fél kockázat", "tone": "warn", "note": note, "reason": "touch_long"}


def nasdaq_points(regime_id: str, fresh: bool) -> float:
    if regime_id == "full":
        return 100.0
    if regime_id == "half":
        return 50.0 + (FRESH_CROSS_BONUS if fresh else 0.0)
    return 0.0


def nasdaq_detail(regime: dict, score: float, fresh: bool) -> str:
    reason = regime.get("reason")
    if regime["id"] == "full":
        text = "Teljes kockázat: a záróár mind a négy átlag felett van → 100."
    elif regime["id"] == "none":
        text = "Nincs kereskedés: a záróár a 20 napos EMA alatt van → 0."
    else:
        if reason == "below_ema9":
            base = "Fél kockázat: a záróár a 9 napos EMA alatt, de a 20 napos EMA felett van"
        elif reason in ("below_long", "touch_long"):
            base = "Fél kockázat: a záróár a 9 és a 20 napos EMA felett van, de a hosszabb távú átlag alatt"
        else:
            base = "Fél kockázat"
        if fresh:
            text = f"{base} → 50 + 10 a friss 9/20 felkeresztezésért → {hu_num(score, 0)}."
        else:
            text = f"{base} → {hu_num(score, 0)}."
    if regime.get("note") and regime["id"] == "half":
        text = f"{text} {regime['note']}"
    return text


def pack_part(part: dict) -> dict:
    _key, label, weight = SCORE_META[part["id"]]
    part["label"] = label
    part["weight"] = weight
    part["tone"] = tone_for(part.get("score")) if part.get("available") else None
    part.setdefault("inputs", {})
    part.setdefault("reason", None)
    part.setdefault("detail", part.get("reason") or "")
    return part


def nasdaq_part(snap: dict) -> dict:
    values = [snap.get(key) for key in ("close", "ema9", "ema20", "sma50", "sma200")]
    if any(value is None for value in values):
        reason = "Nincs elég Nasdaq Composite záróár a 9/20 EMA és az 50/200 SMA kiszámításához."
        return {"id": "nasdaq", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    close, ema9, ema20, sma50, sma200 = (float(value) for value in values)
    fresh = bool(snap.get("fresh"))
    regime = classify_regime(close, ema9, ema20, sma50, sma200)
    score = publish(nasdaq_points(regime["id"], fresh), 1)
    return {
        "id": "nasdaq",
        "available": True,
        "score": score,
        "reason": None,
        "detail": nasdaq_detail(regime, score, fresh),
        "inputs": {
            "regime": regime["id"],
            "regime_label": regime["label"],
            "fresh_up_cross": fresh,
            "bonus": 10 if fresh and regime["id"] == "half" else 0,
        },
    }


def breadth_part(snap: dict) -> dict:
    present = {}
    missing = []
    too_old = []
    for key, label in BREADTH_FIELDS:
        if snap.get(f"{key}_too_old"):
            too_old.append(label)
            missing.append(label)
            continue
        raw = snap.get(key)
        if raw is None:
            missing.append(label)
            continue
        present[key] = publish(raw, 1)
    if not present:
        if too_old:
            reason = "A szélesség utolsó adata túl régi."
        else:
            reason = "Nincs használható szélesség (S&P 500 és Nasdaq-100, 50 és 200 napos arány)."
        return {"id": "breadth", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    average = publish(sum(present.values()) / len(present), 1)
    score = publish(lerp_score(average, 20, 70, 0, 100), 1)
    bits = [f"{label} {hu_num(present[key], 1)}%" for key, label in BREADTH_FIELDS if key in present]
    detail = f"Átlag {hu_num(average, 1)}% → {hu_num(score, 1, trim=True)} pont (20% → 0, 70% → 100). " + " · ".join(bits) + "."
    if missing:
        detail += " Hiányzó arány: " + ", ".join(missing) + "."
    return {
        "id": "breadth",
        "available": True,
        "score": score,
        "reason": None,
        "detail": detail,
        "inputs": {"average": average, "missing_series": missing, **present},
    }


def volatility_part(snap: dict) -> dict:
    if snap.get("vix_too_old"):
        reason = "A VIX utolsó adata túl régi."
        return {"id": "volatility", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    if snap.get("vix") is None:
        reason = "Nincs VIX érték."
        return {"id": "volatility", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    vix = publish(snap["vix"], 2)
    level = publish(lerp_score(vix, 15, 30, 100, 0), 1)
    term_missing = snap.get("vix3m") is None or bool(snap.get("vix3m_too_old"))
    vix3m = None if term_missing else publish(snap["vix3m"], 2)
    inverted = False
    penalty = 0.0
    if term_missing:
        score = level
        extra = " A VIX3M hiányzik, az invertálási levonás nem ellenőrizhető."
    else:
        inverted = vix > vix3m
        penalty = VIX_INVERSION_PENALTY if inverted else 0.0
        score = publish(max(0.0, level - penalty), 1)
        if inverted:
            extra = (
                f" VIX3M {hu_num(vix3m, 2)}: a VIX magasabb, ezért −{hu_num(penalty, 0)} pont "
                f"→ {hu_num(score, 1, trim=True)}."
            )
        else:
            extra = f" VIX3M {hu_num(vix3m, 2)}: nincs invertálás, nincs levonás."
    detail = f"VIX {hu_num(vix, 2)} → szint {hu_num(level, 1, trim=True)} (≤15 → 100, ≥30 → 0)." + extra
    return {
        "id": "volatility",
        "available": True,
        "score": score,
        "reason": None,
        "detail": detail,
        "inputs": {
            "vix": vix,
            "vix3m": vix3m,
            "level_score": level,
            "penalty": penalty,
            "inverted": inverted,
            "term_missing": term_missing,
        },
    }


def credit_part(snap: dict) -> dict:
    if snap.get("hy_too_old"):
        reason = "A bóvli felár utolsó adata túl régi."
        return {"id": "credit", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    if snap.get("hy") is None:
        reason = "Nincs bóvli felár (BAMLH0A0HYM2)."
        return {"id": "credit", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    level = publish(snap["hy"], 2)
    level_score = publish(lerp_score(level, 3, 8, 100, 0), 1)
    change = None if snap.get("hy_change") is None else publish(snap["hy_change"], 2)
    detail = f"Felár {hu_num(level, 2)}% → szint {hu_num(level_score, 1, trim=True)} (≤3% → 100, ≥8% → 0)."
    if change is None:
        score = level_score
        detail += " A 20 napos változás nincs meg, csak a szint számít."
        change_score = None
    else:
        change_score = publish(lerp_score(change, -0.5, 0.5, 100, 0), 1)
        score = publish(0.6 * level_score + 0.4 * change_score, 1)
        detail += (
            f" 20 napos változás {hu_signed(change, 2)} százalékpont → {hu_num(change_score, 1, trim=True)} "
            f"(−0,5 pp → 100, +0,5 pp → 0). Keverés: 60% szint + 40% változás → {hu_num(score, 1, trim=True)}."
        )
    return {
        "id": "credit",
        "available": True,
        "score": score,
        "reason": None,
        "detail": detail,
        "inputs": {
            "level": level,
            "level_score": level_score,
            "change": change,
            "change_score": change_score,
            "change_used": change is not None,
        },
    }


def sentiment_part(snap: dict) -> dict:
    if snap.get("fg_too_old"):
        reason = "A Fear & Greed utolsó adata túl régi."
        return {"id": "sentiment", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    raw = snap.get("fg")
    if raw is None:
        reason = "Nincs CNN Fear & Greed érték."
        return {"id": "sentiment", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    fg = publish(raw, 1)
    if fg is None or fg < 0 or fg > 100:
        reason = "A Fear & Greed érték a 0–100 tartományon kívül esik."
        return {"id": "sentiment", "available": False, "score": None, "reason": reason, "detail": reason, "inputs": {}}
    score = publish(lerp_score(fg, 0, 100, 40, 90), 1)
    detail = (
        f"Fear & Greed {hu_num(fg, 1, trim=True)} → 40 + 0,5 × {hu_num(fg, 1, trim=True)} "
        f"= {hu_num(score, 1, trim=True)}. Enyhe skála: az extrém félelem (0) 40 pont, az extrém kapzsiság (100) 90."
    )
    return {
        "id": "sentiment",
        "available": True,
        "score": score,
        "reason": None,
        "detail": detail,
        "inputs": {"fear_greed": fg},
    }


def build_parts(snap: dict) -> list[dict]:
    builders = (nasdaq_part, breadth_part, volatility_part, credit_part, sentiment_part)
    return [pack_part(builder(snap)) for builder in builders]


def finalize(parts: list[dict]) -> tuple[float | None, int | None, list[dict]]:
    available = [part for part in parts if part.get("available") and part.get("score") is not None]
    total = sum(part["weight"] for part in available)
    for part in parts:
        if part.get("available") and total:
            part["effective_weight"] = publish(part["weight"] / total * 100, 1)
        else:
            part["effective_weight"] = 0
    if not total:
        return None, None, parts
    exact = sum(part["score"] * part["weight"] for part in available) / total
    return exact, int(round_half_up(exact, 0)), parts


def series_from_rows(rows, value_key: str) -> pd.Series:
    data = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        day = row.get("date")
        value = row.get(value_key)
        if not day or value is None:
            continue
        try:
            data[pd.Timestamp(str(day)[:10])] = float(value)
        except (TypeError, ValueError):
            continue
    if not data:
        return pd.Series(dtype=float)
    series = pd.Series(data, dtype=float).sort_index()
    return series[~series.index.duplicated(keep="last")]


def upsert_series(series: pd.Series, day, value) -> pd.Series:
    if day is None or value is None:
        return series
    try:
        number = float(value)
    except (TypeError, ValueError):
        return series
    if math.isnan(number):
        return series
    stamp = pd.Timestamp(str(day)[:10])
    if series is None or series.empty:
        return pd.Series({stamp: number}, dtype=float)
    updated = series.copy()
    updated.loc[stamp] = number
    updated = updated.sort_index()
    return updated[~updated.index.duplicated(keep="last")]


def nasdaq_indicator_frame(closes: pd.Series) -> pd.DataFrame:
    close = closes.astype(float).sort_index()
    close = close[~close.index.duplicated(keep="last")].dropna()
    if close.empty:
        return pd.DataFrame()
    frame = pd.DataFrame(
        {
            "close": close,
            "ema9": close.ewm(span=9, adjust=False).mean(),
            "ema20": close.ewm(span=20, adjust=False).mean(),
            "sma50": close.rolling(50, min_periods=50).mean(),
            "sma200": close.rolling(200, min_periods=200).mean(),
        }
    )
    frame = frame.dropna(subset=["ema9", "ema20", "sma50", "sma200"])
    if frame.empty:
        return frame
    prev9 = frame["ema9"].shift(1)
    prev20 = frame["ema20"].shift(1)
    both = prev9.notna() & prev20.notna()
    frame["up_cross"] = both & (prev9 <= prev20) & (frame["ema9"] > frame["ema20"])
    frame["down_cross"] = both & (prev9 >= prev20) & (frame["ema9"] < frame["ema20"])
    up = frame["up_cross"].astype(int)
    frame["fresh_up"] = up.rolling(FRESH_CROSS_DAYS, min_periods=1).max().astype(bool)
    return frame


def asof_point(series: pd.Series, stamp, max_age_days: int = COMPONENT_MAX_AGE_DAYS):
    if series is None or series.empty:
        return None, None, False
    pos = int(series.index.searchsorted(pd.Timestamp(stamp), side="right")) - 1
    if pos < 0:
        return None, None, False
    point = pd.Timestamp(series.index[pos])
    day = date_str(point)
    age = (pd.Timestamp(stamp).normalize() - point.normalize()).days
    if age > max_age_days:
        return None, day, True
    value = series.iloc[pos]
    if pd.isna(value):
        return None, day, False
    return float(value), day, False


def index_by_id(items, item_id: str) -> dict:
    for item in items or []:
        if isinstance(item, dict) and item.get("id") == item_id:
            return item
    return {}


def empty_trading_score() -> dict:
    return {
        "score": None,
        "score_exact": None,
        "verdict": None,
        "tone": None,
        "method": SCORE_METHOD,
        "renormalized": False,
        "missing": [],
        "components": [],
        "history": [],
        "source": "Saját számítás",
    }


def empty_nasdaq_trend() -> dict:
    return {
        "close": None,
        "regime": None,
        "regime_label": None,
        "averages": [],
        "subscore": None,
        "source": "Yahoo Finance (^IXIC)",
    }


def ma_state(close: float, value: float) -> str:
    if close > value:
        return "above"
    if close < value:
        return "below"
    return "touch"


def build_nasdaq_panel(frame: pd.DataFrame, stamp, subscore, ixic: dict) -> dict:
    row = frame.loc[stamp]
    close = float(row["close"])
    ema9 = float(row["ema9"])
    ema20 = float(row["ema20"])
    sma50 = float(row["sma50"])
    sma200 = float(row["sma200"])
    regime = classify_regime(close, ema9, ema20, sma50, sma200)
    up_index = frame.index[frame["up_cross"].fillna(False).astype(bool)]
    down_index = frame.index[frame["down_cross"].fillna(False).astype(bool)]
    last_up = date_str(up_index[-1]) if len(up_index) else None
    last_down = date_str(down_index[-1]) if len(down_index) else None
    fresh = bool(row["fresh_up"])
    averages = []
    for key, label, kind, period in (
        ("ema9", "9 napos EMA", "EMA", 9),
        ("ema20", "20 napos EMA", "EMA", 20),
        ("sma50", "50 napos SMA", "SMA", 50),
        ("sma200", "200 napos SMA", "SMA", 200),
    ):
        value = float(row[key])
        averages.append(
            {
                "id": key,
                "label": label,
                "kind": kind,
                "period": period,
                "value": rnd(value, 2),
                "distance_pct": rnd((close / value - 1) * 100, 2) if value else None,
                "state": ma_state(close, value),
            }
        )
    status = "stale" if ixic.get("status") == "stale" else "ok"
    panel = {
        "status": status,
        "source": "Yahoo Finance (^IXIC); 9 és 20 napos EMA, 50 és 200 napos SMA",
        "as_of": date_str(stamp),
        "name": ixic.get("name") or "Nasdaq Composite",
        "ticker": "^IXIC",
        "close": rnd(close, 2),
        "averages": averages,
        "regime": regime["id"],
        "regime_label": regime["label"],
        "regime_tone": regime["tone"],
        "regime_note": regime.get("note"),
        "fresh_up_cross": fresh,
        "fresh_up_cross_date": last_up if fresh else None,
        "last_up_cross": last_up,
        "last_down_cross": last_down,
        "subscore": subscore,
        "ma_note": "A 9 és a 20 napos átlag exponenciális (EMA), az 50 és a 200 napos egyszerű (SMA).",
    }
    if status == "stale" and ixic.get("error"):
        panel["error"] = ixic.get("error")
    return panel


def build_market_regime(indices: list, breadth: dict, sentiment: dict) -> tuple[dict, dict]:
    ixic = index_by_id(indices, "ixic")
    closes = upsert_series(series_from_rows(ixic.get("history"), "close"), ixic.get("as_of"), ixic.get("price"))
    frame = nasdaq_indicator_frame(closes) if not closes.empty else pd.DataFrame()

    breadth_rows = list((breadth or {}).get("history") or [])
    current = (breadth or {}).get("current") or {}
    if (breadth or {}).get("as_of") and any(current.get(key) is not None for key, _label in BREADTH_FIELDS):
        breadth_rows.append({"date": breadth.get("as_of"), **{key: current.get(key) for key, _label in BREADTH_FIELDS}})
    breadth_series = {key: series_from_rows(breadth_rows, key) for key, _label in BREADTH_FIELDS}

    sentiment = sentiment or {}
    vix_block = sentiment.get("vix") or {}
    term = sentiment.get("vix_term") or {}
    hy = sentiment.get("hy_spread") or {}
    fear = sentiment.get("fear_greed") or {}

    vix_series = upsert_series(series_from_rows(term.get("history"), "vix"), term.get("as_of"), term.get("vix"))
    vix_series = upsert_series(vix_series, vix_block.get("as_of"), vix_block.get("value"))
    if vix_series.empty:
        vix_series = upsert_series(series_from_rows(vix_block.get("history"), "value"), vix_block.get("as_of"), vix_block.get("value"))
    vix3m_series = upsert_series(series_from_rows(term.get("history"), "vix3m"), term.get("as_of"), term.get("vix3m"))

    hy_series = upsert_series(series_from_rows(hy.get("history"), "value"), hy.get("as_of"), hy.get("value"))
    hy_change = (hy_series - hy_series.shift(20)).dropna() if not hy_series.empty else pd.Series(dtype=float)

    fg_rows = list(fear.get("history") or [])
    if fear.get("as_of") and fear.get("score") is not None:
        fg_rows.append({"date": fear.get("as_of"), "score": fear.get("score")})
    fg_series = series_from_rows(fg_rows, "score")

    if frame is not None and not frame.empty:
        spine = frame.index
    else:
        spine = pd.DatetimeIndex([])
        for candidate in (
            breadth_series["spx200"],
            vix_series,
            hy_series,
            fg_series,
        ):
            if candidate is not None and not candidate.empty:
                spine = candidate.index
                break
    if len(spine) == 0:
        score = empty_trading_score()
        score["status"] = "unavailable"
        score["error"] = "Egyik összetevő sem számolható."
        trend = empty_nasdaq_trend()
        trend["status"] = "unavailable"
        trend["error"] = "Nincs Nasdaq Composite előzmény."
        return trend, score

    def snap_for(stamp) -> dict:
        snap = {}
        if frame is not None and not frame.empty and stamp in frame.index:
            row = frame.loc[stamp]
            snap.update(
                {
                    "close": float(row["close"]),
                    "ema9": float(row["ema9"]),
                    "ema20": float(row["ema20"]),
                    "sma50": float(row["sma50"]),
                    "sma200": float(row["sma200"]),
                    "fresh": bool(row["fresh_up"]),
                }
            )
        for key, _label in BREADTH_FIELDS:
            value, _day, too_old = asof_point(breadth_series[key], stamp)
            snap[key] = value
            snap[f"{key}_too_old"] = too_old and value is None
        vix, _day, vix_old = asof_point(vix_series, stamp)
        vix3m, _day, vix3m_old = asof_point(vix3m_series, stamp)
        snap["vix"] = vix
        snap["vix_too_old"] = vix_old and vix is None
        snap["vix3m"] = None if vix3m_old else vix3m
        snap["vix3m_too_old"] = bool(vix3m_old)
        level, _day, hy_old = asof_point(hy_series, stamp)
        change, _day, _change_old = asof_point(hy_change, stamp)
        snap["hy"] = level
        snap["hy_too_old"] = hy_old and level is None
        snap["hy_change"] = None if hy_old else change
        fg, _day, fg_old = asof_point(fg_series, stamp)
        snap["fg"] = fg
        snap["fg_too_old"] = fg_old and fg is None
        return snap

    dates = list(spine[-SCORE_HISTORY_DAYS:])
    scored = []
    for stamp in dates:
        parts = build_parts(snap_for(stamp))
        exact, headline, parts = finalize(parts)
        if headline is None:
            continue
        scored.append((pd.Timestamp(stamp), exact, headline, parts))
    if not scored:
        score = empty_trading_score()
        score["status"] = "unavailable"
        score["error"] = "Egyik összetevő sem számolható."
        trend = empty_nasdaq_trend()
        trend["status"] = "unavailable"
        trend["error"] = "Nincs értékelhető nap."
        return trend, score

    history = []
    for stamp, _exact, headline, parts in scored:
        row = {"date": date_str(stamp), "score": headline}
        for part in parts:
            row[part["id"]] = part["score"] if part.get("available") else None
        history.append(row)

    stamp, exact, headline, parts = scored[-1]
    band = band_for(headline)
    missing = [part["label"] for part in parts if not part.get("available")]
    vol_stale = vix_block.get("status") == "stale" or (
        parts[2].get("available") and parts[2]["inputs"].get("vix3m") is not None and term.get("status") == "stale"
    )
    source_status = {
        "nasdaq": ixic.get("status"),
        "breadth": (breadth or {}).get("status"),
        "volatility": "stale" if vol_stale else vix_block.get("status"),
        "credit": hy.get("status"),
        "sentiment": fear.get("status"),
    }
    stale_labels = []
    for part in parts:
        part["stale"] = bool(part.get("available") and source_status.get(part["id"]) == "stale")
        if part["stale"]:
            stale_labels.append(part["label"])
    score = {
        "status": "stale" if stale_labels else "ok",
        "source": "Saját számítás: Nasdaq Composite, szélesség, VIX, bóvli felár, CNN Fear & Greed",
        "as_of": date_str(stamp),
        "score": headline,
        "score_exact": publish(exact, 1),
        "verdict": band["verdict"],
        "tone": band["tone"],
        "method": SCORE_METHOD,
        "renormalized": bool(missing),
        "missing": missing,
        "components": parts,
        "history": history,
    }
    if stale_labels:
        score["error"] = "Régebbi adat: " + ", ".join(stale_labels)
    nasdaq_score = next(part["score"] for part in parts if part["id"] == "nasdaq")
    if frame is not None and not frame.empty and stamp in frame.index:
        trend = build_nasdaq_panel(frame, stamp, nasdaq_score, ixic)
    else:
        trend = empty_nasdaq_trend()
        trend["status"] = "unavailable"
        trend["error"] = "Nincs elég Nasdaq Composite előzmény a mozgóátlagokhoz."
    return trend, score


def self_check() -> None:
    assert sum(item[2] for item in SCORE_PARTS) == 100
    assert lerp_score(20, 20, 70, 0, 100) == 0
    assert lerp_score(70, 20, 70, 0, 100) == 100
    assert lerp_score(45, 20, 70, 0, 100) == 50
    assert lerp_score(10, 20, 70, 0, 100) == 0
    assert lerp_score(15, 15, 30, 100, 0) == 100
    assert lerp_score(30, 15, 30, 100, 0) == 0
    assert abs(lerp_score(22.5, 15, 30, 100, 0) - 50) < 1e-9
    assert lerp_score(0, 0, 100, 40, 90) == 40
    assert lerp_score(100, 0, 100, 40, 90) == 90
    assert abs(lerp_score(50, 0, 100, 40, 90) - 65) < 1e-9
    assert [band_for(score)["tone"] for score in (0, 39, 40, 59, 60, 79, 80, 100)] == [
        "bad",
        "bad",
        "warn",
        "warn",
        "good",
        "good",
        "strong",
        "strong",
    ]
    assert band_for(39)["verdict"] == "Nem érdemes kereskedni"
    assert band_for(40)["verdict"] == "Óvatosan / fél kockázat"
    assert band_for(60)["verdict"] == "Kedvező"
    assert band_for(80)["verdict"] == "Erős piac"

    assert classify_regime(100, 90, 80, 70, 60)["id"] == "full"
    below9 = classify_regime(85, 90, 80, 70, 60)
    assert below9["id"] == "half" and below9["reason"] == "below_ema9"
    assert classify_regime(75, 90, 80, 70, 60)["id"] == "none"
    below_long = classify_regime(100, 90, 80, 110, 70)
    assert below_long["id"] == "half" and "50 napos SMA" in below_long["note"]
    below_both = classify_regime(100, 90, 80, 110, 120)
    assert "50 napos SMA" in below_both["note"] and "200 napos SMA" in below_both["note"]
    assert nasdaq_points("full", True) == 100
    assert nasdaq_points("half", False) == 50
    assert nasdaq_points("half", True) == 60
    assert nasdaq_points("none", True) == 0

    breadth = breadth_part({"spx50": 20, "spx200": 70, "ndx50": 45, "ndx200": None})
    assert breadth["available"] and breadth["score"] == 50
    assert "Nasdaq-100 200 napos" in breadth["inputs"]["missing_series"]
    assert volatility_part({"vix": 15, "vix3m": 14})["score"] == 80
    assert volatility_part({"vix": 30, "vix3m": 40})["score"] == 0
    partial_vol = volatility_part({"vix": 22.5, "vix3m": None})
    assert partial_vol["score"] == 50 and partial_vol["inputs"]["term_missing"] is True
    assert credit_part({"hy": 3, "hy_change": 0.5})["score"] == 60
    assert credit_part({"hy": 5.5, "hy_change": 0})["score"] == 50
    assert credit_part({"hy": 3, "hy_change": None})["score"] == 100
    assert sentiment_part({"fg": 0})["score"] == 40
    assert sentiment_part({"fg": 100})["score"] == 90
    assert sentiment_part({"fg": 50})["score"] == 65
    assert sentiment_part({"fg": None})["available"] is False

    parts = build_parts(
        {
            "close": 100,
            "ema9": 90,
            "ema20": 80,
            "sma50": 70,
            "sma200": 60,
            "fresh": True,
            "spx50": 20,
            "spx200": 70,
            "ndx50": 45,
            "ndx200": 45,
            "vix": None,
            "hy": 3,
            "hy_change": 0.5,
            "fg": 80,
        }
    )
    exact, headline, done = finalize(parts)
    # Nasdaq 100, breadth of 20/70/45/45 = 45 → 50, volatility missing, credit 60, sentiment 80.
    # (100*35 + 50*25 + 60*10 + 80*10) / 80 = 76.875
    assert abs(exact - 76.875) < 1e-9
    assert headline == 77
    assert next(part["effective_weight"] for part in done if part["id"] == "volatility") == 0

    bull = pd.Series(
        [100 * (1.002**i) for i in range(260)],
        index=pd.bdate_range("2021-01-01", periods=260),
    )
    bull_frame = nasdaq_indicator_frame(bull)
    last = bull_frame.iloc[-1]
    assert (
        classify_regime(float(last.close), float(last.ema9), float(last.ema20), float(last.sma50), float(last.sma200))["id"]
        == "full"
    )

    price = 100.0
    prices = []
    for _ in range(220):
        price *= 1.001
        prices.append(price)
    for _ in range(15):
        price *= 0.97
        prices.append(price)
    for _ in range(40):
        price *= 1.02
        prices.append(price)
    crash = nasdaq_indicator_frame(pd.Series(prices, index=pd.bdate_range("2020-01-01", periods=len(prices))))
    assert bool(crash["down_cross"].any())
    assert bool(crash["up_cross"].any())
    up_days = crash.index[crash["up_cross"].astype(bool)]
    down_days = crash.index[crash["down_cross"].astype(bool)]
    assert up_days[-1] > down_days[-1]
    cross_at = crash.index.get_loc(up_days[-1])
    assert bool(crash.iloc[cross_at]["fresh_up"]) is True
    if cross_at + FRESH_CROSS_DAYS < len(crash):
        assert bool(crash.iloc[cross_at + FRESH_CROSS_DAYS]["fresh_up"]) is False
    saw_none = False
    for _, row in crash.iterrows():
        regime = classify_regime(float(row.close), float(row.ema9), float(row.ema20), float(row.sma50), float(row.sma200))
        if regime["id"] == "none":
            saw_none = True
            break
    assert saw_none
    end = crash.iloc[-1]
    assert classify_regime(float(end.close), float(end.ema9), float(end.ema20), float(end.sma50), float(end.sma200))["id"] == "full"

    index = pd.bdate_range("2022-01-03", periods=260)
    history = [{"date": date_str(day), "close": 100 * (1.0015**i)} for i, day in enumerate(index)]
    indices = [
        {
            "id": "ixic",
            "name": "Nasdaq Composite",
            "status": "ok",
            "as_of": history[-1]["date"],
            "price": history[-1]["close"],
            "history": history,
        }
    ]
    breadth_rows = [
        {"date": date_str(day), "spx50": 62, "spx200": 60, "ndx50": 58, "ndx200": 55} for day in index[199:]
    ]
    breadth_block = {
        "status": "ok",
        "as_of": breadth_rows[-1]["date"],
        "current": {key: breadth_rows[-1][key] for key in ("spx50", "spx200", "ndx50", "ndx200")},
        "history": breadth_rows,
    }
    vix_rows = [{"date": date_str(day), "vix": 16, "vix3m": 18} for day in index]
    sentiment = {
        "vix": {
            "status": "ok",
            "as_of": vix_rows[-1]["date"],
            "value": 16,
            "history": [{"date": row["date"], "value": row["vix"]} for row in vix_rows],
        },
        "vix_term": {"status": "ok", "as_of": vix_rows[-1]["date"], "vix": 16, "vix3m": 18, "history": vix_rows},
        "fear_greed": {
            "status": "ok",
            "as_of": date_str(index[-1]),
            "score": 55,
            "history": [{"date": date_str(day), "score": 55} for day in index[-80:]],
        },
        "hy_spread": {
            "status": "ok",
            "as_of": date_str(index[-1]),
            "value": 3.2,
            "history": [{"date": date_str(day), "value": 3.2} for day in index],
        },
    }
    trend, score = build_market_regime(indices, breadth_block, sentiment)
    by_id = {part["id"]: part for part in score["components"]}
    assert trend["regime"] == "full"
    assert trend["subscore"] == 100
    assert trend["fresh_up_cross"] is False
    assert by_id["nasdaq"]["score"] == 100
    assert by_id["breadth"]["score"] == 77.6
    assert by_id["volatility"]["score"] == 93.3
    assert by_id["credit"]["score"] == 77.6
    assert by_id["sentiment"]["score"] == 67.5
    assert score["score"] == 88
    assert score["score_exact"] == 87.6
    assert score["verdict"] == "Erős piac"
    assert len(score["history"]) == SCORE_HISTORY_DAYS
    assert score["history"][-1]["score"] == score["score"]
    assert score["history"][-1]["date"] == trend["as_of"]
    sentiment["fear_greed"] = {"status": "unavailable", "score": None, "history": []}
    _trend, reduced = build_market_regime(indices, breadth_block, sentiment)
    assert "Hangulat" in reduced["missing"]
    assert reduced["renormalized"] is True
    nasdaq_weight = next(part["effective_weight"] for part in reduced["components"] if part["id"] == "nasdaq")
    assert nasdaq_weight == 38.9
    assert abs(sum(part["effective_weight"] for part in reduced["components"] if part["available"]) - 100) < 0.11
    assert "Qullamaggie" not in SCORE_METHOD
    assert "qullamaggie" not in SCORE_METHOD.lower()
    assert classify_regime(100, 90, 80, 70, 60)["label"] == "Teljes kockázat"

    index = pd.bdate_range("2024-12-16", periods=40)
    prices = pd.Series([100 + i for i in range(40)], index=index, dtype=float)
    last = float(prices.iloc[-1])
    assert abs(session_return(prices, 5) - (last / float(prices.iloc[-6]) - 1) * 100) < 1e-9
    assert abs(session_return(prices, 21) - (last / float(prices.iloc[-22]) - 1) * 100) < 1e-9
    prior = prices[prices.index < pd.Timestamp("2025-01-01")]
    assert abs(ytd_return(prices) - (last / float(prior.iloc[-1]) - 1) * 100) < 1e-9
    assert session_return(prices.iloc[:3], 5) is None
    assert ytd_return(pd.Series([1.0, 2.0], index=pd.bdate_range("2025-01-02", periods=2))) is None

    moment = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)
    raw_news = [
        {
            "title": "Stocks rally on earnings",
            "url": "https://example.com/a?utm_source=rss",
            "source": "CNBC",
            "published": moment - timedelta(hours=2),
            "market": True,
        },
        {
            "title": "Stocks rally on earnings!",
            "url": "https://example.com/a",
            "source": "Yahoo Finance",
            "published": moment - timedelta(hours=1),
            "market": True,
        },
        {
            "title": "Oil jumps as yields fall",
            "url": "https://example.com/b",
            "source": "Reuters",
            "published": moment - timedelta(hours=3),
            "market": True,
        },
        {
            "title": "Celebrity lists a house",
            "url": "https://example.com/c",
            "source": "MarketWatch",
            "published": moment - timedelta(hours=1),
            "market": False,
        },
        {
            "title": "Fed holds rates",
            "url": "https://example.com/d",
            "source": "CNBC",
            "published": moment - timedelta(hours=40),
            "market": True,
        },
    ]
    fresh = [row for row in raw_news if moment - row["published"] <= timedelta(hours=NEWS_WINDOW_HOURS)]
    deduped = dedupe_news(fresh)
    assert len(deduped) == 3
    assert deduped[0]["url"].rstrip("/").endswith("/a")
    picked = select_headlines(deduped)
    titles = [row["title"] for row in picked]
    assert any(title.startswith("Stocks rally on earnings") for title in titles)
    assert "Oil jumps as yields fall" in titles
    assert "Fed holds rates" not in titles
    rally_at = next(index for index, title in enumerate(titles) if title.startswith("Stocks rally on earnings"))
    assert rally_at < titles.index("Celebrity lists a house")
    assert market_related("A forint gyengült a dollárral szemben")
    assert market_related("Nasdaq futures rise before the Fed")
    assert not market_related("Celebrity lists a house")
    log("Pontszám önellenőrzés rendben.")


def attach_history(item: dict, previous_items: dict, limit: int) -> dict:
    if item.get("status") == "ok" and item.get("id") in previous_items:
        item["history"] = merge_rows(previous_items[item["id"]].get("history"), item.get("history"), limit)
    elif item.get("status") == "ok":
        item["history"] = merge_rows([], item.get("history"), limit)
    return item


def finish_instrument(meta: dict, series_map: dict[str, pd.Series], source: str, previous_items: dict) -> dict:
    ticker = meta["ticker"]
    try:
        if ticker not in series_map:
            raise RuntimeError("nincs árfolyam")
        quote = quote_from_series(meta, series_map[ticker], source)
    except Exception as exc:
        log(f"  {meta['name']}: {exc}")
        quote = as_stale(previous_items.get(meta["id"]), str(exc), empty_quote(meta, source))
    return attach_history(quote, previous_items, LIMITS["daily"])


def session_return(series: pd.Series, sessions: int):
    clean = series.dropna().sort_index()
    clean = clean[~clean.index.duplicated(keep="last")]
    if len(clean) <= sessions:
        return None
    last = float(clean.iloc[-1])
    base = float(clean.iloc[-1 - sessions])
    if base == 0 or pd.isna(last) or pd.isna(base):
        return None
    return (last / base - 1.0) * 100.0


def ytd_return(series: pd.Series):
    clean = series.dropna().sort_index()
    clean = clean[~clean.index.duplicated(keep="last")]
    if clean.empty:
        return None
    year_start = pd.Timestamp(year=int(clean.index[-1].year), month=1, day=1)
    prior = clean[clean.index < year_start]
    if prior.empty:
        return None
    base = float(prior.iloc[-1])
    last = float(clean.iloc[-1])
    if base == 0 or pd.isna(base) or pd.isna(last):
        return None
    return (last / base - 1.0) * 100.0


def _spread(left, right):
    if left is None or right is None:
        return None
    return left - right


def empty_sectors() -> dict:
    return {
        "source": "Yahoo Finance (XLK, XLF, XLV, XLY, XLP, XLE, XLI, XLB, XLU, XLRE, XLC, SPY)",
        "as_of": None,
        "benchmark": None,
        "sectors": [],
        "leaders": [],
        "laggards": [],
    }


def build_sectors(series_map: dict[str, pd.Series]) -> dict:
    def pack_benchmark(series: pd.Series) -> dict:
        week = session_return(series, SECTOR_WEEK_SESSIONS)
        month = session_return(series, SECTOR_MONTH_SESSIONS)
        ytd = ytd_return(series)
        clean = series.dropna()
        return {
            "ticker": BENCHMARK_TICKER,
            "name": "S&P 500 ETF",
            "as_of": date_str(clean.index[-1]) if len(clean) else None,
            "price": rnd(float(clean.iloc[-1]), 2) if len(clean) else None,
            "week_pct": rnd(week, 2),
            "month_pct": rnd(month, 2),
            "ytd_pct": rnd(ytd, 2),
        }

    spy = series_map.get(BENCHMARK_TICKER)
    benchmark = pack_benchmark(spy) if spy is not None and spy.dropna().shape[0] >= 2 else None
    rows = []
    for meta in SECTORS:
        series = series_map.get(meta["ticker"])
        if series is None or series.dropna().shape[0] < 2:
            rows.append(
                {
                    "id": meta["id"],
                    "ticker": meta["ticker"],
                    "name": meta["name"],
                    "name_en": meta["name_en"],
                    "as_of": None,
                    "price": None,
                    "week_pct": None,
                    "month_pct": None,
                    "ytd_pct": None,
                    "week_vs_spy": None,
                    "month_vs_spy": None,
                    "ytd_vs_spy": None,
                    "role": None,
                }
            )
            continue
        clean = series.dropna()
        week = rnd(session_return(series, SECTOR_WEEK_SESSIONS), 2)
        month = rnd(session_return(series, SECTOR_MONTH_SESSIONS), 2)
        ytd = rnd(ytd_return(series), 2)
        spy_week = None if benchmark is None else benchmark["week_pct"]
        spy_month = None if benchmark is None else benchmark["month_pct"]
        spy_ytd = None if benchmark is None else benchmark["ytd_pct"]
        rows.append(
            {
                "id": meta["id"],
                "ticker": meta["ticker"],
                "name": meta["name"],
                "name_en": meta["name_en"],
                "as_of": date_str(clean.index[-1]),
                "price": rnd(float(clean.iloc[-1]), 2),
                "week_pct": week,
                "month_pct": month,
                "ytd_pct": ytd,
                "week_vs_spy": rnd(_spread(week, spy_week), 2),
                "month_vs_spy": rnd(_spread(month, spy_month), 2),
                "ytd_vs_spy": rnd(_spread(ytd, spy_ytd), 2),
                "role": None,
            }
        )
    ranked = [row for row in rows if row["week_pct"] is not None]
    ranked.sort(key=lambda row: row["week_pct"], reverse=True)
    count = len(ranked)
    if count >= 6:
        leader_n, lag_n = 3, 3
    elif count >= 2:
        leader_n, lag_n = 1, 1
    else:
        leader_n, lag_n = 0, 0
    leader_ids = {row["id"] for row in ranked[:leader_n]}
    lag_ids = {row["id"] for row in ranked[-lag_n:]} - leader_ids
    for row in rows:
        if row["id"] in leader_ids:
            row["role"] = "leader"
        elif row["id"] in lag_ids:
            row["role"] = "laggard"
    rows.sort(key=lambda row: (row["week_pct"] is None, -(row["week_pct"] or 0)))
    dated = [row["as_of"] for row in rows if row.get("as_of")]
    if not ranked:
        raise RuntimeError("egy szektor ETF-nek sincs heti hozama")
    leaders = [
        {"id": row["id"], "ticker": row["ticker"], "name": row["name"], "week_pct": row["week_pct"]}
        for row in rows
        if row["role"] == "leader"
    ]
    laggards = [
        {"id": row["id"], "ticker": row["ticker"], "name": row["name"], "week_pct": row["week_pct"]}
        for row in rows
        if row["role"] == "laggard"
    ]
    return {
        "status": "ok",
        "source": "Yahoo Finance, osztalékkal igazított záróár (SPDR szektor ETF-ek és SPY)",
        "as_of": max(dated) if dated else None,
        "week_sessions": SECTOR_WEEK_SESSIONS,
        "month_sessions": SECTOR_MONTH_SESSIONS,
        "benchmark": benchmark,
        "sectors": rows,
        "leaders": leaders,
        "laggards": laggards,
        "note": (
            "Az 1 hét az utolsó 5 kereskedési nap hozama, az 1 hónap 21 kereskedési nap. "
            "A YTD az idei év első kereskedési napja előtti záróártól mért hozam. "
            "A SPY-hez képesti szám a szektor hozama mínusz az S&P 500 ETF hozama ugyanazon az időtávon."
        ),
    }


def norm_title(title: str) -> str:
    text = re.sub(r"\s+[-–|]\s+reuters\s*$", "", title.strip(), flags=re.IGNORECASE)
    text = text.casefold()
    text = re.sub(r"[^\w\s]", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def norm_url(url: str) -> str:
    text = url.split("#", 1)[0]
    text = re.sub(r"\?.*$", "", text)
    return text.lower().rstrip("/")


def market_related(title: str) -> bool:
    if MARKET_RE.search(title):
        return True
    folded = title.casefold()
    return any(hint in folded for hint in HU_MARKET_HINTS)


def parse_news_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = raw.strip()
    parsed = None
    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        parsed = None
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def xml_local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def xml_text(elem: ET.Element, name: str) -> str:
    for child in list(elem):
        if xml_local(child.tag) == name and child.text and child.text.strip():
            return " ".join(child.text.split())
    return ""


def xml_link(elem: ET.Element) -> str:
    for child in list(elem):
        if xml_local(child.tag) != "link":
            continue
        if child.text and child.text.strip():
            return child.text.strip()
        href = (child.attrib.get("href") or "").strip()
        if href:
            return href
    return ""


def dedupe_news(items: list[dict]) -> list[dict]:
    ordered = sorted(items, key=lambda row: row["published"], reverse=True)
    seen_titles: set[str] = set()
    seen_urls: set[str] = set()
    kept = []
    for row in ordered:
        title = norm_title(row.get("title") or "")
        url = norm_url(row.get("url") or "")
        if not title or not url:
            continue
        if title in seen_titles or url in seen_urls:
            continue
        seen_titles.add(title)
        seen_urls.add(url)
        kept.append(row)
    return kept


def select_headlines(items: list[dict]) -> list[dict]:
    ordered = sorted(items, key=lambda row: row["published"], reverse=True)
    chosen: list[dict] = []
    counts: dict[str, int] = {}

    def take(pool: list[dict], cap: int, limit: int) -> None:
        for row in pool:
            if len(chosen) >= limit:
                return
            if any(existing is row for existing in chosen):
                continue
            source = row.get("source") or ""
            if counts.get(source, 0) >= cap:
                continue
            chosen.append(row)
            counts[source] = counts.get(source, 0) + 1

    market = [row for row in ordered if row.get("market")]
    other = [row for row in ordered if not row.get("market")]
    take(market, NEWS_PER_SOURCE, NEWS_LIMIT)
    if len(chosen) < NEWS_TARGET:
        take(market, 99, NEWS_LIMIT)
    if len(chosen) < NEWS_TARGET:
        take(other, 2, NEWS_TARGET)
    chosen.sort(key=lambda row: row["published"], reverse=True)
    return chosen[:NEWS_LIMIT]


def news_public(row: dict) -> dict:
    local = row["published"].astimezone(BUDAPEST)
    title = re.sub(r"\s+[-–|]\s+reuters\s*$", "", row["title"], flags=re.IGNORECASE).strip()
    return {
        "title": title,
        "source": row["source"],
        "url": row["url"],
        "published_at": local.isoformat(timespec="seconds"),
        "published_budapest": f"{local.year}. {MONTHS_HU[local.month - 1]} {local.day}., {local:%H:%M}",
    }


def parse_feed_items(payload: bytes, source: str, now: datetime) -> list[dict]:
    root = ET.fromstring(payload)
    found = []
    for elem in root.iter():
        if xml_local(elem.tag) not in {"item", "entry"}:
            continue
        title = xml_text(elem, "title")
        url = xml_link(elem)
        published = (
            parse_news_datetime(xml_text(elem, "pubDate"))
            or parse_news_datetime(xml_text(elem, "published"))
            or parse_news_datetime(xml_text(elem, "updated"))
            or parse_news_datetime(xml_text(elem, "date"))
        )
        if not title or not url or published is None:
            continue
        age = now.astimezone(timezone.utc) - published
        if age < timedelta(0) and age > timedelta(hours=-3):
            age = timedelta(0)
        if age < timedelta(0) or age > timedelta(hours=NEWS_WINDOW_HOURS):
            continue
        found.append(
            {
                "title": title,
                "url": url,
                "source": source,
                "published": published,
                "market": market_related(title),
            }
        )
    return found


def empty_news() -> dict:
    return {
        "source": "RSS: CNBC, MarketWatch, Yahoo Finance, Reuters, Portfolio.hu",
        "window_hours": NEWS_WINDOW_HOURS,
        "items": [],
        "feeds": [],
    }


def fresh_previous_news(previous: dict, now: datetime) -> list[dict]:
    block = previous.get("news") if isinstance(previous, dict) else None
    if not isinstance(block, dict):
        return []
    kept = []
    for row in block.get("items") or []:
        if not isinstance(row, dict):
            continue
        published = parse_news_datetime(row.get("published_at"))
        if published is None:
            continue
        age = now.astimezone(timezone.utc) - published
        if timedelta(0) <= age <= timedelta(hours=NEWS_WINDOW_HOURS):
            kept.append(dict(row))
    return kept


def build_news(session: requests.Session, now: datetime) -> dict:
    collected: list[dict] = []
    feeds = []
    for feed in NEWS_FEEDS:
        try:
            response = session.get(
                feed["url"],
                headers={
                    "User-Agent": BROWSER_UA,
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                },
                timeout=(8, 20),
            )
            response.raise_for_status()
            sample = response.text.lstrip()[:300].lower()
            if not (sample.startswith("<?xml") or "<rss" in sample or "<feed" in sample):
                raise RuntimeError("a válasz nem hírfolyam")
            parsed = parse_feed_items(response.content, feed["name"], now)
            collected.extend(parsed)
            feeds.append(
                {
                    "id": feed["id"],
                    "name": feed["name"],
                    "status": "ok",
                    "items": len(parsed),
                    "error": None,
                    "note": "Google News, reuters.com szűrő" if feed["id"] == "reuters" else None,
                }
            )
            log(f"  hír {feed['name']} ({feed['id']}): {len(parsed)} friss cím")
        except Exception as exc:
            message = str(exc).strip().splitlines()[-1][:240]
            log(f"  hír {feed['name']} ({feed['id']}) hiba: {message}")
            feeds.append(
                {
                    "id": feed["id"],
                    "name": feed["name"],
                    "status": "unavailable",
                    "items": 0,
                    "error": message,
                }
            )
    chosen = select_headlines(dedupe_news(collected))
    if not chosen:
        failed = [feed["name"] for feed in feeds if feed["status"] != "ok"]
        raise RuntimeError("nincs friss cím" + (f"; elbukott: {', '.join(failed)}" if failed else ""))
    names = []
    for feed in feeds:
        if feed["name"] not in names:
            names.append(feed["name"])
    return {
        "status": "ok",
        "source": "RSS: " + ", ".join(names),
        "as_of": chosen[0]["published"].astimezone(BUDAPEST).isoformat(timespec="seconds"),
        "window_hours": NEWS_WINDOW_HOURS,
        "items": [news_public(row) for row in chosen],
        "feeds": feeds,
    }


def main() -> int:
    self_check()
    started = time.time()
    now = datetime.now(BUDAPEST)
    previous = load_previous()
    session = http_session()
    log("Összetevőlisták…")
    spx_members, spx_origin = load_universe(session, "sp500")
    ndx_members, ndx_origin = load_universe(session, "nasdaq100")

    market_tickers = (
        [item["ticker"] for item in INDICES + EXTRAS]
        + list(VIX_TICKERS.values())
        + [item["ticker"] for item in SECTORS]
        + [BENCHMARK_TICKER]
    )
    log(f"Indexek, VIX és egyéb piacok ({len(market_tickers)} ticker)…")
    try:
        market = download_closes(market_tickers, PRICE_PERIOD)
        series_map = {str(column): market[column].dropna() for column in market.columns}
    except Exception as exc:
        log(f"Piaci árfolyamok hibája: {exc}")
        traceback.print_exc()
        series_map = {}
        market_error = exc
    else:
        market_error = None

    prev_indices = {item["id"]: item for item in previous.get("indices") or [] if isinstance(item, dict)}
    prev_extras = {item["id"]: item for item in previous.get("extras") or [] if isinstance(item, dict)}
    if market_error and not series_map:
        indices = [
            as_stale(prev_indices.get(meta["id"]), str(market_error), empty_quote(meta, "Yahoo Finance"))
            for meta in INDICES
        ]
        extras = [
            as_stale(prev_extras.get(meta["id"]), str(market_error), empty_quote(meta, "Yahoo Finance"))
            for meta in EXTRAS
        ]
        sentiment_prev = previous.get("sentiment") or {}
        vix_blocks = {
            "vix": as_stale(sentiment_prev.get("vix"), str(market_error), {"value": None, "history": []}),
            "vix_term": as_stale(
                sentiment_prev.get("vix_term"), str(market_error), {"vix": None, "history": []}
            ),
        }
    else:
        indices = [finish_instrument(meta, series_map, "Yahoo Finance", prev_indices) for meta in INDICES]
        extras = [finish_instrument(meta, series_map, "Yahoo Finance", prev_extras) for meta in EXTRAS]
        try:
            vix_blocks = build_vix_blocks(series_map)
            sentiment_prev = previous.get("sentiment") or {}
            for key in ("vix", "vix_term"):
                vix_blocks[key]["history"] = merge_rows(
                    (sentiment_prev.get(key) or {}).get("history"),
                    vix_blocks[key].get("history"),
                    LIMITS["daily"],
                )
        except Exception as exc:
            log(f"VIX hiba: {exc}")
            traceback.print_exc()
            sentiment_prev = previous.get("sentiment") or {}
            vix_blocks = {
                "vix": as_stale(sentiment_prev.get("vix"), str(exc), {"value": None, "history": [], "source": "Yahoo Finance (^VIX)"}),
                "vix_term": as_stale(
                    sentiment_prev.get("vix_term"),
                    str(exc),
                    {"vix": None, "history": [], "source": "Yahoo Finance"},
                ),
            }

    log("BUX a Budapesti Értéktőzsdéről…")
    try:
        bux_series = fetch_bux(session)
        bux_meta = {
            "id": "bux",
            "name": "BUX",
            "ticker": "BUX",
            "digits": 2,
            "group": "eu",
            "unit": "HUF",
        }
        bux_quote = quote_from_series(bux_meta, bux_series, "Budapesti Értéktőzsde")
        bux_quote = attach_history(bux_quote, prev_indices, LIMITS["daily"])
    except Exception as exc:
        log(f"BUX hiba: {exc}")
        traceback.print_exc()
        bux_quote = as_stale(
            prev_indices.get("bux"),
            str(exc),
            empty_quote(
                {"id": "bux", "name": "BUX", "ticker": "BUX", "digits": 2, "group": "eu", "unit": "HUF"},
                "Budapesti Értéktőzsde",
            ),
        )
    indices.append(bux_quote)

    log("Piaci szélesség…")
    try:
        log(f"  S&P 500, {len(spx_members)} ticker")
        spx_prices = download_closes([row["symbol"] for row in spx_members], PRICE_PERIOD)
        log(f"  Nasdaq-100, {len(ndx_members)} ticker")
        ndx_prices = download_closes([row["symbol"] for row in ndx_members], PRICE_PERIOD)
        breadth = build_breadth(spx_prices, ndx_prices, len(spx_members), len(ndx_members))
        breadth["history"] = merge_rows((previous.get("breadth") or {}).get("history"), breadth["history"], LIMITS["breadth"])
        breadth["lists"] = {"spx": spx_origin, "ndx": ndx_origin}
    except Exception as exc:
        log(f"Szélesség hiba: {exc}")
        traceback.print_exc()
        breadth = as_stale(
            previous.get("breadth"),
            str(exc),
            {
                "source": "Saját számítás",
                "as_of": None,
                "current": {},
                "history": [],
            },
        )

    log("CNN Fear & Greed és put/call…")
    sentiment_prev = previous.get("sentiment") or {}
    try:
        cnn = fetch_cnn(session)
        for key in ("fear_greed", "put_call"):
            if cnn[key].get("status") != "ok":
                cnn[key] = as_stale(
                    sentiment_prev.get(key),
                    cnn[key].get("error") or "érvénytelen CNN válasz",
                    cnn[key],
                )
                continue
            cnn[key]["history"] = merge_rows(
                (sentiment_prev.get(key) or {}).get("history"),
                cnn[key].get("history"),
                LIMITS["cnn"],
            )
    except Exception as exc:
        log(f"CNN hiba: {exc}")
        traceback.print_exc()
        cnn = {
            "fear_greed": as_stale(
                sentiment_prev.get("fear_greed"),
                str(exc),
                {"score": None, "history": [], "source": "CNN Fear & Greed"},
            ),
            "put_call": as_stale(
                sentiment_prev.get("put_call"),
                str(exc),
                {"value": None, "history": [], "source": "CNN Fear & Greed put/call komponens"},
            ),
        }

    log("AAII felmérés…")
    try:
        aaii = fetch_aaii(session)
        aaii["history"] = merge_rows((sentiment_prev.get("aaii") or {}).get("history"), aaii["history"], LIMITS["aaii"])
        if aaii["history"]:
            latest = aaii["history"][-1]
            aaii["as_of"] = latest["date"]
            aaii["bull"] = latest["bull"]
            aaii["neutral"] = latest["neutral"]
            aaii["bear"] = latest["bear"]
            aaii["spread"] = latest["spread"]
    except Exception as exc:
        log(f"AAII hiba: {exc}")
        traceback.print_exc()
        aaii = as_stale(
            sentiment_prev.get("aaii"),
            str(exc),
            {"bull": None, "history": [], "source": "AAII Investor Sentiment Survey"},
        )

    log("FRED hozamok…")
    try:
        yields = build_yields(session)
        yields["history"] = merge_rows((previous.get("yields") or {}).get("history"), yields["history"], LIMITS["yields"])
    except Exception as exc:
        log(f"Hozam hiba, Treasury tartalék: {exc}")
        traceback.print_exc()
        try:
            yields = build_treasury_yields(session)
            yields["history"] = merge_rows(
                (previous.get("yields") or {}).get("history"), yields["history"], LIMITS["yields"]
            )
            yields["fred_error"] = str(exc).strip().splitlines()[-1][:300]
        except Exception as treasury_exc:
            log(f"Treasury hozam hiba: {treasury_exc}")
            traceback.print_exc()
            yields = as_stale(
                previous.get("yields"),
                f"FRED: {exc}; Treasury: {treasury_exc}",
                {"current": {}, "history": [], "source": "FRED"},
            )
    try:
        hy_spread = build_hy_spread(session)
        hy_spread["history"] = merge_rows(
            (sentiment_prev.get("hy_spread") or {}).get("history"),
            hy_spread["history"],
            LIMITS["yields"],
        )
    except Exception as exc:
        log(f"Hitelkockázati felár hiba: {exc}")
        traceback.print_exc()
        hy_spread = as_stale(
            sentiment_prev.get("hy_spread"),
            str(exc),
            {"value": None, "history": [], "source": "FRED BAMLH0A0HYM2"},
        )

    market_date = None
    for item in indices:
        if item.get("id") == "spx" and item.get("as_of"):
            market_date = item["as_of"]
    sentiment = {
        "vix": vix_blocks["vix"],
        "vix_term": vix_blocks["vix_term"],
        "fear_greed": cnn["fear_greed"],
        "aaii": aaii,
        "put_call": cnn["put_call"],
        "hy_spread": hy_spread,
    }
    log("Szektorok…")
    try:
        sectors = build_sectors(series_map)
    except Exception as exc:
        log(f"Szektor hiba: {exc}")
        traceback.print_exc()
        sectors = as_stale(previous.get("sectors"), str(exc), empty_sectors())

    log("Napi hírek…")
    try:
        news = build_news(session, now)
    except Exception as exc:
        log(f"Hír hiba: {exc}")
        traceback.print_exc()
        fresh_items = fresh_previous_news(previous, now)
        if fresh_items:
            news = as_stale(previous.get("news"), str(exc), empty_news())
            news["items"] = fresh_items
            news["window_hours"] = NEWS_WINDOW_HOURS
        else:
            news = as_stale(None, str(exc), empty_news())

    log("Kereskedési pontszám és Nasdaq trendszűrő…")
    try:
        nasdaq_trend, trading_score = build_market_regime(indices, breadth, sentiment)
    except Exception as exc:
        log(f"Pontszám hiba: {exc}")
        traceback.print_exc()
        nasdaq_trend = as_stale(previous.get("nasdaq_trend"), str(exc), empty_nasdaq_trend())
        trading_score = as_stale(previous.get("trading_score"), str(exc), empty_trading_score())
    dashboard = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": now.isoformat(timespec="seconds"),
            "generated_at_budapest": budapest_stamp(now),
            "timezone": "Europe/Budapest",
            "market_date": market_date,
            "price_period": PRICE_PERIOD,
        },
        "trading_score": trading_score,
        "nasdaq_trend": nasdaq_trend,
        "breadth": breadth,
        "sentiment": sentiment,
        "indices": indices,
        "yields": yields,
        "extras": extras,
        "sectors": sectors,
        "news": news,
    }
    write_dashboard(dashboard)
    elapsed = round(time.time() - started, 1)
    log(f"Kész {elapsed} s alatt → {DATA_PATH}")
    summarize(dashboard)
    return 0


def summarize(dashboard: dict) -> None:
    score = dashboard.get("trading_score") or {}
    trend = dashboard.get("nasdaq_trend") or {}
    log(
        f"Pontszám {score.get('status')} {score.get('score')} {score.get('verdict')} "
        f"pontos={score.get('score_exact')} hiányzik={score.get('missing')} nap={score.get('as_of')} "
        f"történet={len(score.get('history') or [])}"
    )
    for part in score.get("components") or []:
        log(
            f"  rész {part.get('id')}: available={part.get('available')} score={part.get('score')} "
            f"w={part.get('weight')} eff={part.get('effective_weight')}"
        )
    log(
        f"Nasdaq {trend.get('status')} close={trend.get('close')} {trend.get('regime_label')} "
        f"fresh={trend.get('fresh_up_cross')} up={trend.get('last_up_cross')} down={trend.get('last_down_cross')}"
    )
    breadth = dashboard["breadth"]
    current = breadth.get("current") or {}
    log(
        "Szélesség "
        f"{breadth.get('status')} S&P200={current.get('spx200')} S&P50={current.get('spx50')} "
        f"NDX200={current.get('ndx200')} NDX50={current.get('ndx50')} nap={breadth.get('as_of')} "
        f"pontok={len(breadth.get('history') or [])}"
    )
    sentiment = dashboard["sentiment"]
    for key in ("vix", "vix_term", "fear_greed", "aaii", "put_call", "hy_spread"):
        block = sentiment[key]
        log(f"  {key}: {block.get('status')} as_of={block.get('as_of')} pontok={len(block.get('history') or [])}")
    for item in dashboard["indices"] + dashboard["extras"]:
        log(
            f"  {item['id']}: {item.get('status')} {item.get('price')} "
            f"{item.get('change_pct')}% 50={item.get('dist50_pct')} 200={item.get('dist200_pct')} "
            f"pontok={len(item.get('history') or [])}"
        )
    yields = dashboard["yields"]
    log(f"Hozamok {yields.get('status')} {yields.get('current')} pontok={len(yields.get('history') or [])}")
    sectors = dashboard.get("sectors") or {}
    log(
        f"Szektorok {sectors.get('status')} nap={sectors.get('as_of')} "
        f"vezető={[row.get('ticker') for row in sectors.get('leaders') or []]} "
        f"lemaradó={[row.get('ticker') for row in sectors.get('laggards') or []]}"
    )
    for row in sectors.get("sectors") or []:
        log(
            f"  {row.get('ticker')} {row.get('name')}: hét={row.get('week_pct')} "
            f"hó={row.get('month_pct')} ytd={row.get('ytd_pct')} vs={row.get('week_vs_spy')} {row.get('role')}"
        )
    news = dashboard.get("news") or {}
    log(f"Hírek {news.get('status')} {len(news.get('items') or [])} cím, forrás={news.get('source')}")
    for feed in news.get("feeds") or []:
        log(f"  feed {feed.get('id')}: {feed.get('status')} {feed.get('items')} {feed.get('error') or ''}")


if __name__ == "__main__":
    raise SystemExit(main())
