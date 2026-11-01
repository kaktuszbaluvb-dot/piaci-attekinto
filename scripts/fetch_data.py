#!/usr/bin/env python3
"""Piaci áttekintő adatlekérés.

Ingyenes, kulcs nélküli forrásokból tölti le az árakat és a hangulatadatokat,
kiszámolja a piaci szélességet, majd a web/data/dashboard.json fájlba ír.
Ha egy forrás elbukik, a korábbi jó értéket megtartja és stale jelzéssel látja el.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
import traceback
import warnings
from datetime import date, datetime, timedelta
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
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
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
    if block.get("history"):
        return True
    for key in ("value", "price", "score", "bull", "vix"):
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
    response = session.get(FRED_URL.format(series_id=series_id), timeout=40)
    response.raise_for_status()
    frame = pd.read_csv(io.StringIO(response.text))
    if frame.shape[1] < 2:
        raise RuntimeError(f"{series_id} CSV túl keskeny")
    frame.columns = ["date", "value"]
    frame["value"] = pd.to_numeric(frame["value"], errors="coerce")
    frame = frame.dropna(subset=["value"])
    if frame.empty:
        raise RuntimeError(f"{series_id} üres")
    frame["date"] = pd.to_datetime(frame["date"])
    return frame.set_index("date")["value"].sort_index()


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


def main() -> int:
    started = time.time()
    now = datetime.now(BUDAPEST)
    previous = load_previous()
    session = http_session()
    log("Összetevőlisták…")
    spx_members, spx_origin = load_universe(session, "sp500")
    ndx_members, ndx_origin = load_universe(session, "nasdaq100")

    market_tickers = [item["ticker"] for item in INDICES + EXTRAS] + list(VIX_TICKERS.values())
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
        log(f"Hozam hiba: {exc}")
        traceback.print_exc()
        yields = as_stale(previous.get("yields"), str(exc), {"current": {}, "history": [], "source": "FRED"})
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
    dashboard = {
        "meta": {
            "schema_version": SCHEMA_VERSION,
            "generated_at": now.isoformat(timespec="seconds"),
            "generated_at_budapest": budapest_stamp(now),
            "timezone": "Europe/Budapest",
            "market_date": market_date,
            "price_period": PRICE_PERIOD,
        },
        "breadth": breadth,
        "sentiment": {
            "vix": vix_blocks["vix"],
            "vix_term": vix_blocks["vix_term"],
            "fear_greed": cnn["fear_greed"],
            "aaii": aaii,
            "put_call": cnn["put_call"],
            "hy_spread": hy_spread,
        },
        "indices": indices,
        "yields": yields,
        "extras": extras,
    }
    write_dashboard(dashboard)
    elapsed = round(time.time() - started, 1)
    log(f"Kész {elapsed} s alatt → {DATA_PATH}")
    summarize(dashboard)
    return 0


def summarize(dashboard: dict) -> None:
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


if __name__ == "__main__":
    raise SystemExit(main())
