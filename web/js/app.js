const THEME_KEY = "piaci-theme";

const PART_HINT = {
  nasdaq: "A Nasdaq Composite záróára a 9 és 20 napos exponenciális, valamint az 50 és 200 napos egyszerű átlaghoz képest.",
  breadth: "Az S&P 500 és a Nasdaq-100 részvényeinek mekkora része van a saját 50 és 200 napos átlaga felett.",
  volatility: "A VIX szintje. Ha a 30 napos VIX a 3 hónapos felett van, a pontszám csökken.",
  credit: "Az amerikai bóvli kötvényfelár szintje és az utóbbi 20 nap változása. A táguló felár ront.",
  sentiment: "A CNN félelem–kapzsiság indexe, enyhe skálán. Az extrém félelem rontja a pontot.",
};

const REGIME_HELP = {
  full: "Az ár a 9 és 20 napos exponenciális, valamint az 50 és 200 napos egyszerű átlag felett van. A rövid és a hosszú trend együtt emelkedik.",
  half: "Vegyes kép: a rövid trend még tart, de vagy a 9 napos átlag alatt van az ár, vagy egy hosszabb átlag ellenáll. A modell ilyenkor fél kockázatot számol.",
  none: "Az ár a 20 napos exponenciális átlag alatt van. A rövid emelkedő trend megtört, a modell szerint nincs új long belépés.",
};

const charts = [];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  return new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function fmtPct(value, digits = 2) {
  return fmtSigned(value, digits, "%");
}

function fmtSigned(value, digits, suffix) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const number = Number(value);
  const body = fmt(Math.abs(number), digits);
  if (number > 0) return `+${body}${suffix}`;
  if (number < 0) return `−${body}${suffix}`;
  return `${body}${suffix}`;
}

function signClass(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

function fmtScore(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const number = Number(value);
  if (Math.abs(number - Math.round(number)) < 0.05) return fmt(number, 0);
  return fmt(number, 1);
}

function fmtWeight(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const digits = Math.abs(Number(value) - Math.round(Number(value))) < 0.05 ? 0 : 1;
  return `${fmt(value, digits)}%`;
}

function fmtPp(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return fmtSigned(value, 1, " pp");
}

function weekChange(history, key) {
  const rows = (history || []).filter((row) => row[key] !== null && row[key] !== undefined);
  if (rows.length < 6) return null;
  return rows[rows.length - 1][key] - rows[rows.length - 6][key];
}

function weightLabel(part, renormalized) {
  const nominal = fmtWeight(part.weight);
  if (!renormalized || !part.available || part.effective_weight === null || part.effective_weight === undefined) {
    return nominal;
  }
  if (Math.abs(Number(part.effective_weight) - Number(part.weight)) < 0.05) return nominal;
  return `${nominal} → ${fmtWeight(part.effective_weight)}`;
}

function formatDay(iso) {
  if (!iso) return "–";
  const [year, month, day] = String(iso).slice(0, 10).split("-");
  return `${year}. ${month}. ${day}.`;
}

function ago(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "az imént";
  if (mins < 60) return `${mins} perce`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} órája`;
  return `${Math.round(hours / 24)} napja`;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch (error) {
    return "";
  }
  return "";
}

function isoDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function observedHoliday(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  else if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function nthWeekdayOfMonth(year, monthIndex, weekday, n) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return 1 + shift + (n - 1) * 7;
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  return last.getUTCDate() - shift;
}

function goodFriday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return easter.toISOString().slice(0, 10);
}

function usMarketHolidays(year) {
  return new Set([
    observedHoliday(year, 0, 1),
    isoDate(year, 0, nthWeekdayOfMonth(year, 0, 1, 3)),
    isoDate(year, 1, nthWeekdayOfMonth(year, 1, 1, 3)),
    goodFriday(year),
    isoDate(year, 4, lastWeekdayOfMonth(year, 4, 1)),
    observedHoliday(year, 5, 19),
    observedHoliday(year, 6, 4),
    isoDate(year, 8, nthWeekdayOfMonth(year, 8, 1, 1)),
    isoDate(year, 10, nthWeekdayOfMonth(year, 10, 4, 4)),
    observedHoliday(year, 11, 25),
  ]);
}

const holidayCache = new Map();

function holidaySet(year) {
  if (!holidayCache.has(year)) holidayCache.set(year, usMarketHolidays(year));
  return holidayCache.get(year);
}

function isUsTradingDay(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const year = date.getUTCFullYear();
  return !holidaySet(year - 1).has(iso) && !holidaySet(year).has(iso) && !holidaySet(year + 1).has(iso);
}

function shiftTradingDay(iso, step) {
  const date = new Date(`${iso}T00:00:00Z`);
  for (let i = 0; i < 12; i += 1) {
    date.setUTCDate(date.getUTCDate() + step);
    const next = date.toISOString().slice(0, 10);
    if (isUsTradingDay(next)) return next;
  }
  return iso;
}

function lastCompletedUsSession(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  if (isUsTradingDay(today) && minutes >= 16 * 60) return today;
  return shiftTradingDay(today, -1);
}

function expectedAsOf(kind, now = new Date()) {
  const session = lastCompletedUsSession(now);
  if (kind === "fred") return shiftTradingDay(session, -1);
  if (kind === "weekly") {
    const date = new Date(now.getTime() - 12 * 86400000);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Budapest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
  return session;
}

function freshness(block, kind = "equity") {
  if (!block || block.status === "ok" || !block.status) return "ok";
  if (block.status === "unavailable") return "unavailable";
  if (block.status !== "stale") return "ok";
  const asOf = String(block.as_of || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "stale";
  return asOf >= expectedAsOf(kind) ? "ok" : "stale";
}

function statusBadge(block, kind = "equity") {
  const state = freshness(block, kind);
  if (state === "unavailable") {
    return `<span class="badge bad" title="Ehhez a mutatóhoz még nincs megjeleníthető adat.">Nem elérhető</span>`;
  }
  if (state === "stale") {
    return `<span class="asof-note">utolsó adat: ${formatDay(block.as_of)}</span>`;
  }
  return "";
}

function unavailable(title, block) {
  const why = block && block.error ? " A forrás nem válaszolt, és nincs korábbi érték." : "";
  return `<article class="card"><h3>${esc(title)}</h3><p class="empty">Ez a mutató most nem elérhető.${esc(why)}</p></article>`;
}

function breadthStory(value) {
  if (value === null || value === undefined) return "A 200 napos szélesség most nem számolható.";
  if (value >= 80) return "A piac nagyon széles: a részvények túlnyomó része a hosszú átlag felett van. Ez erős, de már feszített állapot.";
  if (value >= 60) return "Széles emelkedés: a részvények többsége a saját 200 napos átlaga felett forog.";
  if (value >= 40) return "Vegyes kép: a részvények körülbelül fele van a hosszú átlag felett.";
  if (value >= 20) return "Szűk piac: a részvények többsége a hosszú átlag alatt van, még ha az indexet néhány nagy papír tartja is.";
  return "Széles gyengeség: szinte minden részvény a hosszú átlag alatt forog.";
}

function vixWord(value) {
  if (value === null || value === undefined) return "";
  if (value < 15) return "nyugodt";
  if (value < 20) return "visszafogott";
  if (value < 30) return "emelkedett";
  return "magas félelem";
}

function vixClass(value) {
  if (value === null || value === undefined) return "";
  if (value < 20) return "calm";
  if (value < 30) return "warn";
  return "hot";
}

function structureText(structure) {
  if (structure === "contango") {
    return "Contango: a három hónapos VIX magasabb a 30 naposnál, a piac nem áraz közeli sokkot.";
  }
  if (structure === "backwardation") {
    return "Backwardation: a rövid távú félelem drágább a három hónaposnál. Ez stresszes környezet.";
  }
  if (structure === "flat") return "A VIX görbe lapos: nincs erős rövid távú stresszfelár.";
  return "A lejárati szerkezet most nem ítélhető meg.";
}

function putWord(value) {
  if (value === null || value === undefined) return "";
  if (value < 0.7) return "kevés védelem";
  if (value <= 1) return "semleges";
  return "védekező";
}

function hyWord(value) {
  if (value === null || value === undefined) return "";
  if (value < 3) return "szűk felár";
  if (value < 5) return "átlagos";
  if (value < 8) return "feszült";
  return "stressz";
}

function themeTooltip() {
  return {
    backgroundColor: cssVar("--card"),
    titleColor: cssVar("--text"),
    bodyColor: cssVar("--muted"),
    borderColor: cssVar("--line-strong"),
    borderWidth: 1,
    padding: 10,
    cornerRadius: 10,
    displayColors: true,
    boxPadding: 4,
  };
}

function baseOptions(extra = {}) {
  const tick = cssVar("--chart-tick");
  const grid = cssVar("--chart-grid");
  const muted = cssVar("--muted");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 420, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          pointStyle: "circle",
          color: muted,
          padding: 12,
          font: { size: 12 },
        },
      },
      tooltip: {
        ...themeTooltip(),
        callbacks: {
          label(context) {
            const digits = context.dataset.digits ?? 1;
            const value = context.parsed.y;
            const suffix = context.dataset.suffix || "";
            return `${context.dataset.label}: ${fmt(value, digits)}${suffix}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { maxTicksLimit: 6, color: tick, font: { size: 11 } },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        grace: "8%",
        ticks: { color: tick, font: { size: 11 } },
        grid: { color: grid },
        border: { display: false },
      },
    },
    elements: {
      point: { radius: 0, hitRadius: 10, hoverRadius: 3 },
      line: { tension: 0.25, borderWidth: 1.5, borderCapStyle: "round", borderJoinStyle: "round" },
    },
    ...extra,
  };
}

function colorFor(dataset) {
  if (dataset.colorRole === "updown") return dataset.rising ? cssVar("--up") : cssVar("--down");
  if (dataset.colorRole === "zero") return cssVar("--chart-zero");
  if (dataset.colorRole) return cssVar(dataset.colorRole);
  return cssVar("--c1");
}

function mountChart(canvas, config) {
  if (!canvas || typeof Chart === "undefined") return;
  charts.push(new Chart(canvas, config));
}

function paintCharts() {
  const tick = cssVar("--chart-tick");
  const grid = cssVar("--chart-grid");
  const muted = cssVar("--muted");
  const tip = themeTooltip();
  charts.forEach((chart) => {
    const scales = chart.options.scales || {};
    if (scales.x && scales.x.ticks) scales.x.ticks.color = tick;
    if (scales.y && scales.y.ticks) scales.y.ticks.color = tick;
    if (scales.y && scales.y.grid) scales.y.grid.color = grid;
    const labels = chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels;
    if (labels) labels.color = muted;
    if (chart.options.plugins && chart.options.plugins.tooltip) {
      Object.assign(chart.options.plugins.tooltip, tip);
    }
    chart.data.datasets.forEach((dataset) => {
      dataset.borderColor = colorFor(dataset);
    });
    chart.update("none");
  });
}

function syncThemeControls() {
  const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  document.documentElement.style.colorScheme = theme;
  const button = document.getElementById("theme-toggle");
  if (button) {
    const label = theme === "dark" ? "Váltás világos témára" : "Váltás sötét témára";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0F1314" : "#f5f5f7");
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    /* a téma enélkül is vált, csak nem marad meg */
  }
  syncThemeControls();
  paintCharts();
}

function lineData(history, key) {
  const rows = (history || []).filter((row) => row[key] !== null && row[key] !== undefined);
  return {
    labels: rows.map((row) => row.date),
    values: rows.map((row) => row[key]),
  };
}

function hiddenScales() {
  return {
    x: { display: false, ticks: { color: cssVar("--chart-tick") }, grid: { display: false } },
    y: { display: false, ticks: { color: cssVar("--chart-tick") }, grid: { display: false } },
  };
}

function sparkOptions() {
  return baseOptions({
    plugins: {
      legend: { display: false },
      tooltip: { ...themeTooltip(), callbacks: baseOptions().plugins.tooltip.callbacks },
    },
    scales: hiddenScales(),
  });
}

function scoreBand(value) {
  if (value < 40) return "bad";
  if (value < 60) return "warn";
  if (value < 80) return "good";
  return "strong";
}

function scoreSpark(history) {
  const rows = (history || []).filter((row) => row.score !== null && row.score !== undefined);
  if (rows.length < 2) return "";
  const values = rows.map((row) => Number(row.score));
  const width = 360;
  const height = 124;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 12;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const yOf = (value) => padT + (1 - Math.max(0, Math.min(100, value)) / 100) * plotH;
  const xOf = (index) => padL + (index / (values.length - 1)) * plotW;
  const points = values.map((value, index) => ({ x: xOf(index), y: yOf(value), v: value }));
  const pieces = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const cuts = [40, 60, 80]
      .filter((level) => (level - start.v) * (level - end.v) < 0)
      .sort((left, right) => Math.abs(left - start.v) - Math.abs(right - start.v));
    const nodes = [start];
    const delta = end.v - start.v;
    cuts.forEach((level) => {
      const ratio = (level - start.v) / delta;
      nodes.push({ x: start.x + ratio * (end.x - start.x), y: yOf(level), v: level });
    });
    nodes.push(end);
    for (let node = 0; node < nodes.length - 1; node += 1) {
      const left = nodes[node];
      const right = nodes[node + 1];
      pieces.push({ left, right, band: scoreBand((left.v + right.v) / 2) });
    }
  }
  const baseline = yOf(0);
  const areas = pieces.map((piece) => {
    const path = `M${piece.left.x.toFixed(1)} ${piece.left.y.toFixed(1)} L${piece.right.x.toFixed(1)} ${piece.right.y.toFixed(1)} L${piece.right.x.toFixed(1)} ${baseline.toFixed(1)} L${piece.left.x.toFixed(1)} ${baseline.toFixed(1)} Z`;
    return `<path class="spark-area band-${piece.band}" d="${path}"></path>`;
  }).join("");
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const guides = [40, 60, 80].map((level) => {
    const y = yOf(level).toFixed(1);
    return `<line class="spark-guide" x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}"></line>`;
  }).join("");
  const labels = [0, 40, 60, 100].map((level) => {
    return `<text class="spark-tick num" x="2" y="${yOf(level).toFixed(1)}">${level}</text>`;
  }).join("");
  const stops = [
    ["0%", "strong"],
    ["20%", "strong"],
    ["20%", "good"],
    ["40%", "good"],
    ["40%", "warn"],
    ["60%", "warn"],
    ["60%", "bad"],
    ["100%", "bad"],
  ].map(([offset, band]) => `<stop offset="${offset}" style="stop-color:var(--spark-${band})"/>`).join("");
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `
    <div class="spark-block">
      <svg class="score-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="A kereskedési pontszám az utolsó ${rows.length} kereskedési napon, 0-tól 100-ig. A vonal színe a sávot követi: 39-ig piros, 40–59 borostyán, 60–79 zöld, 80-tól sötétzöld. A tartomány ${fmt(min, 0)}–${fmt(max, 0)}.">
        <defs>
          <linearGradient id="score-spark-band" gradientUnits="userSpaceOnUse" x1="0" y1="${yOf(100)}" x2="0" y2="${yOf(0)}">
            ${stops}
          </linearGradient>
        </defs>
        ${areas}
        ${guides}
        <path class="spark-line" stroke="url(#score-spark-band)" d="${line}"></path>
        <circle class="spark-dot band-${scoreBand(last.v)}" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.6"></circle>
        ${labels}
      </svg>
      <p class="spark-caption">Utolsó ${rows.length} kereskedési nap · ${formatDay(rows[0].date)} – ${formatDay(rows[rows.length - 1].date)} · ${fmt(min, 0)}–${fmt(max, 0)}</p>
    </div>`;
}

function methodology() {
  return `
    <details class="method">
      <summary>Hogyan számolunk?</summary>
      <div class="method-body">
        <p>A kereskedési pontszám 0 és 100 között azt méri, mennyire kedvező a környezet a trendkövető, emelkedésre játszó swing kereskedéshez. Nem fordított jelzés: a nagy félelem rontja a pontot, nem javítja. Öt rész súlyozott átlaga. Ha egy résznek nincs friss adata, a súlya a többire oszlik, és ez a felületen látszik. A kijelzett szám az átlag egészre kerekítve. A sávok: 0–39 nem érdemes kereskedni, 40–59 óvatosan, 60–79 kedvező, 80–100 erős piac.</p>
        <p>A kész végösszeget a Nasdaq záróára még keretezheti. Az 50 napos átlag alatt a pont legfeljebb 39. Az 50 napos felett, de a 20 napos alatt legfeljebb 59; ha közben a 9 napos felett is van, legalább 40. Ha az ár a 9, a 20 és az 50 napos átlag felett van, nincs felső határ, és a pont legalább 40. Ha a 20 napos felett, de a 9 napos alatt van, csak a felső határ érvényes: legfeljebb 59.</p>
        <ul>
          <li><b>Nasdaq-trend, 35%.</b> Mind a négy átlag felett 100 pont. Vegyes helyzetben 50, és ehhez 10 jár, ha a 9 napos átlag az utolsó öt napban alulról a 20 napos fölé fordult. A 20 napos alatt 0 pont.</li>
          <li><b>Piaci szélesség, 25%.</b> A négy „átlag feletti részvény” arány átlaga. 15% körül 0 pont, 80% körül 100 pont, a kettő között egyenletesen nő.</li>
          <li><b>Volatilitás, 20%.</b> Alacsony VIX sok pontot ér, 30 körül vagy felette keveset. Ha a 30 napos VIX a 3 hónapos felett van, 20 pont levonás.</li>
          <li><b>Hitelkockázat, 10%.</b> Szűk bóvli felár jobb, táguló felár ront. A szint számít jobban, a 20 napos változás kisebb súllyal. Ha a változás hiányzik, csak a szint számít.</li>
          <li><b>Hangulat, 10%.</b> A pont a Fear &amp; Greeddel együtt nő; a nagyon erős félelem plusz pontot kap a visszapattanás esélyéért, a nagyon erős kapzsiság pontot veszít.</li>
        </ul>
        <p>A kis görbe az utolsó 60 kereskedési nap. A Nasdaq trendszűrő ugyanezt a négy átlagot mutatja külön is.</p>
      </div>
    </details>`;
}

function plainPart(part) {
  if (!part.available || part.score === null || part.score === undefined) {
    return part.reason || "Ehhez a részhez most nincs használható adat.";
  }
  const inputs = part.inputs || {};
  if (part.id === "nasdaq") return plainNasdaq(inputs);
  if (part.id === "breadth") return plainBreadth(inputs);
  if (part.id === "volatility") return plainVolatility(inputs);
  if (part.id === "credit") return plainCredit(inputs);
  if (part.id === "sentiment") return plainSentiment(inputs);
  return part.reason || "";
}

function plainNasdaq(inputs) {
  if (inputs.regime === "full") {
    return "Az ár mind a négy átlag felett van: a rövid és a hosszú trend együtt emelkedik.";
  }
  if (inputs.regime === "none") {
    return "Az ár a 20 napos átlag alatt van, a rövid emelkedő trend megtört.";
  }
  if (inputs.regime === "half") {
    const fresh = inputs.fresh_up_cross
      ? " A 9 napos átlag nemrég fordult a 20 napos fölé."
      : "";
    return `A kép vegyes: a rövid trend még tart, de nem minden átlag támogatja.${fresh}`;
  }
  return "A Nasdaq-trend most nem ítélhető meg.";
}

function plainBreadth(inputs) {
  const average = Number(inputs.average);
  if (!Number.isFinite(average)) return "A szélesség most nem számolható.";
  let read = "túladott, a részvények nagy része a hosszú átlag alatt van";
  if (average > 80) read = "túlvett, szinte minden részvény az átlag felett van";
  else if (average >= 55) read = "közepesen erős, széles emelkedés";
  else if (average >= 40) read = "vegyes kép";
  else if (average >= 20) read = "szűk, gyenge piac";
  return `A részvények ${fmt(average, 0)}%-a van a mozgóátlagai felett – ${read}.`;
}

function plainVolatility(inputs) {
  const vix = Number(inputs.vix);
  if (!Number.isFinite(vix)) return "A volatilitás most nem számolható.";
  if (inputs.inverted) {
    return `A VIX ${fmt(vix, 0)} és a három hónapos fölött van: a közeli félelem a szokásosnál drágább.`;
  }
  let level = "magas, a piac félelmet áraz";
  if (vix < 15) level = "alacsony, a piac nyugodt";
  else if (vix < 20) level = "visszafogott";
  else if (vix < 30) level = "emelkedett, de nincs pánik";
  return `A VIX ${fmt(vix, 0)} körül van: a bizonytalanság ${level}.`;
}

function plainCredit(inputs) {
  const level = Number(inputs.level);
  if (!Number.isFinite(level)) return "A hitelkockázat most nem számolható.";
  let state = "nagyon tág, a hitelpiac stresszes";
  if (level < 3.5) state = "a hitelpiac nyugodt";
  else if (level < 5) state = "nincs stressz a hitelpiacon";
  else if (level < 8) state = "a kockázatkerülés nő";
  const change = Number(inputs.change);
  if (inputs.change_used && Number.isFinite(change) && Math.abs(change) >= 0.15) {
    const move = change > 0 ? "tágult" : "szűkült";
    return `A bóvli felár ${fmt(level, 1)}%, és az utóbbi hetekben ${move}: ${state}.`;
  }
  return `A bóvli felár ${fmt(level, 1)}% körül van, és alig mozdult: ${state}.`;
}

function plainSentiment(inputs) {
  const fg = Number(inputs.fear_greed);
  if (!Number.isFinite(fg)) return "A hangulat most nem számolható.";
  let read = "erős kapzsiság";
  if (fg < 25) read = "erős félelem";
  else if (fg < 45) read = "inkább félelem";
  else if (fg < 55) read = "semleges hangulat";
  else if (fg < 75) read = "inkább optimizmus";
  else if (fg <= 80) read = "kapzsiság";
  return `A Fear & Greed ${fmt(fg, 0)}, ${read}: a pont a hangulattal együtt nő, 10 alatt a félelem plusz pontot kap a visszapattanás esélyéért, 80 felett a kapzsiság pontot veszít.`;
}

function bandLabels() {
  const ticks = [0, 40, 60, 80, 100];
  return `<div class="band-labels num">${ticks.map((value, index) => {
    const edge = index === 0 ? "is-first" : index === ticks.length - 1 ? "is-last" : "";
    return `<span class="${edge}" style="left:${value}%">${value}</span>`;
  }).join("")}</div>`;
}

function renderScorePart(part, renormalized) {
  const missing = !part.available || part.score === null || part.score === undefined;
  const width = missing ? 0 : Math.max(0, Math.min(100, Number(part.score)));
  const tone = part.tone || "";
  const hint = PART_HINT[part.id] || "";
  return `
    <div class="part${missing ? " is-missing" : ""}">
      <div class="part-top">
        <span class="part-name" title="${esc(hint)}">${esc(part.label || part.id)}</span>
        <span class="part-meta num"><span>${missing ? "–" : fmtScore(part.score)}</span><span>${esc(weightLabel(part, renormalized))}</span></span>
      </div>
      <div class="bar" aria-hidden="true"><i class="tone-${esc(tone)}" style="width:${width}%"></i></div>
      <p class="part-detail">${esc(plainPart(part))}</p>
    </div>`;
}

function shownBreadthRatios(breadth) {
  const current = (breadth && breadth.current) || {};
  return ["spx50", "spx200", "ndx50", "ndx200"]
    .map((key) => Number(current[key]))
    .filter((value) => Number.isFinite(value));
}

function overboughtNote(breadth, sentiment, block) {
  const ratios = shownBreadthRatios(breadth);
  const part = ((block && block.components) || []).find((item) => item.id === "breadth");
  const fromScore = part && part.inputs ? Number(part.inputs.average) : NaN;
  const average = Number.isFinite(fromScore)
    ? fromScore
    : ratios.length
      ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length
      : null;
  const fg = Number(sentiment && sentiment.fear_greed && sentiment.fear_greed.score);
  const hot = ratios.some((value) => value > 80)
    || (average !== null && average > 80)
    || (Number.isFinite(fg) && fg > 80);
  if (!hot) return "";
  return `<p class="overbought">Túlvett piac. Ha még nem léptél be, ne üldözd az emelkedést.</p>`;
}

function renderTradingScore(block, breadth, sentiment) {
  if (!block || block.score === null || block.score === undefined) {
    return `<section id="pontszam">${unavailable("Kereskedési pontszám", block)}</section>`;
  }
  const tone = block.tone || "good";
  const parts = block.components || [];
  const missing = block.missing || [];
  const missingLine = missing.length
    ? `<p class="missing-note">Hiányzó rész: ${esc(missing.join(", "))}. A súlyok a rendelkezésre álló részekre vannak elosztva.</p>`
    : "";
  return `
    <section id="pontszam" class="score-section">
      <article class="card score-card">
        <div class="score-layout">
          <div class="score-main">
            <div class="score-kicker">
              <h2>Kereskedési pontszám</h2>
              ${statusBadge(block)}
            </div>
            <p class="score-lead">Azt mutatja, mennyire kedvező a környezet a trendkövető, emelkedésre játszó swing kereskedéshez. Nem fordított jelzés.</p>
            <div class="score-figure">
              <span class="score-num num tone-${esc(tone)}">${fmt(block.score, 0)}</span>
              <span class="score-of">/ 100</span>
            </div>
            <p class="verdict tone-${esc(tone)}">${esc(block.verdict || "")}</p>
            <div class="band-wrap" aria-hidden="true">
              <div class="band" title="0–39 nem érdemes kereskedni, 40–59 óvatosan, 60–79 kedvező, 80–100 erős piac.">
                <i class="b-bad"></i><i class="b-warn"></i><i class="b-good"></i><i class="b-strong"></i>
              </div>
              <em class="band-mark" style="left:${Math.max(0, Math.min(100, Number(block.score)))}%"></em>
            </div>
            ${bandLabels()}
            ${scoreSpark(block.history)}
            ${overboughtNote(breadth, sentiment, block)}
          </div>
          <div class="score-side">
            ${missingLine}
            <div class="parts">
              ${parts.map((part) => renderScorePart(part, block.renormalized)).join("")}
            </div>
          </div>
        </div>
        ${methodology()}
        <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
      </article>
    </section>`;
}

function maState(state) {
  if (state === "above") return { text: "Felette", cls: "up" };
  if (state === "below") return { text: "Alatta", cls: "down" };
  return { text: "Érinti", cls: "flat" };
}

function renderAverage(item) {
  const state = maState(item.state);
  return `
    <article class="ma-tile" title="A záróár ${esc(state.text.toLowerCase())} van ehhez az átlaghoz képest. A százalék a távolság.">
      <div class="ma-kicker"><span>${esc(item.label)}</span><span class="pill ${state.cls}">${state.text}</span></div>
      <div class="ma-value num">${fmt(item.value, 2)}</div>
      <div class="ma-dist num ${state.cls}">${fmtPct(item.distance_pct, 1)}</div>
      <p class="ma-sub">távolság a záróártól</p>
    </article>`;
}

function renderCross(trend) {
  const down = trend.last_down_cross ? formatDay(trend.last_down_cross) : "nincs a tárolt időszakban";
  if (trend.fresh_up_cross && trend.fresh_up_cross_date) {
    return `
      <div class="cross-fresh">Friss trendinduló jel: a 9 napos átlag ${formatDay(trend.fresh_up_cross_date)} napján alulról keresztezte a 20 naposat. Az utolsó öt kereskedési napban ez még frissnek számít.</div>
      <p class="cross-quiet">Utolsó lefelé keresztezés: ${down}.</p>`;
  }
  const up = trend.last_up_cross ? formatDay(trend.last_up_cross) : "nincs a tárolt időszakban";
  return `<p class="cross-quiet">Utolsó felfelé keresztezés, amikor a 9 napos átlag a 20 napos fölé emelkedett: ${up}. Utolsó lefelé keresztezés: ${down}.</p>`;
}

function renderNasdaqTrend(trend) {
  if (!trend || trend.close === null || trend.close === undefined || !trend.regime_label) {
    return unavailable("Nasdaq trendszűrő", trend);
  }
  const tone = trend.regime_tone || "warn";
  const help = REGIME_HELP[trend.regime] || "";
  return `
    <article class="card nasdaq-card">
      <div class="nasdaq-top">
        <div>
          <p class="eyebrow">Nasdaq Composite · ${formatDay(trend.as_of)}</p>
          <p class="nasdaq-close num">${fmt(trend.close, 2)}</p>
        </div>
        <p class="regime tone-${esc(tone)}" title="${esc(help)}">${esc(trend.regime_label)}</p>
      </div>
      <p class="regime-note">${esc(trend.regime_note || help)}</p>
      <div class="ma-grid">
        ${(trend.averages || []).map(renderAverage).join("")}
      </div>
      ${renderCross(trend)}
      <p class="source">${statusBadge(trend)} Részpont a kereskedési pontszámban: <span class="num">${fmtScore(trend.subscore)}</span> / 100. A 9 és a 20 napos átlag exponenciális, az 50 és a 200 napos egyszerű.</p>
    </article>`;
}

function renderQuote(item) {
  if (!item || item.price === null || item.price === undefined) {
    return unavailable(item ? item.name : "Index", item);
  }
  const digits = item.digits ?? 2;
  const unit = item.unit && item.unit !== "index" ? ` ${item.unit}` : "";
  return `
    <article class="card">
      <div class="card-kicker">
        <h3>${esc(item.name)}</h3>
        <span class="badge" title="${esc(item.ticker)}">${esc(item.ticker)}</span>
      </div>
      <div class="price-row">
        <span class="price num">${fmt(item.price, digits)}</span>
        <span class="chg num ${signClass(item.change_pct)}" title="Napi változás">${fmtPct(item.change_pct)}</span>
      </div>
      <div class="dma" title="Pozitív százalék: az ár az átlag felett van. Negatív: alatta.">
        <span>50 napos <b class="num ${signClass(item.dist50_pct)}">${fmtPct(item.dist50_pct, 1)}</b></span>
        <span>200 napos <b class="num ${signClass(item.dist200_pct)}">${fmtPct(item.dist200_pct, 1)}</b></span>
      </div>
      <div class="chart-box spark"><canvas id="spark-${esc(item.id)}"></canvas></div>
      <p class="spark-caption">Utolsó egy év</p>
      <p class="source">${formatDay(item.as_of)}${unit ? " · " + esc(unit.trim()) : ""} · ${statusBadge(item)}</p>
    </article>`;
}

function renderIndices(indices, trend) {
  return `
    <section id="indexek">
      <div class="section-head">
        <div>
          <h2>Indexek és a Nasdaq trendje</h2>
          <p>Először a Nasdaq Composite helyzete a rövid és a hosszú átlagokhoz képest, utána a fő indexek záróára. A nagy százalék a napi változás. A 50 és 200 napos sor azt mutatja, hány százalékkal van az ár a saját átlaga felett vagy alatt.</p>
        </div>
      </div>
      ${renderNasdaqTrend(trend)}
      <div class="grid-quotes" style="margin-top:12px">
        ${indices.map(renderQuote).join("")}
      </div>
      <article class="card panel">
        <div class="card-kicker"><h3>Egyéves összevetés</h3></div>
        <p class="fine">Minden index 100-ról indul az ablak elején, így a görbék a hozamot hasonlítják össze, nem az ár szintjét.</p>
        <div class="chart-box mid"><canvas id="chart-compare"></canvas></div>
      </article>
    </section>`;
}

function breadthZone(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return { zone: "none", pill: "Nincs adat", pillClass: "" };
  if (number < 20) return { zone: "bad", pill: "Túladott", pillClass: "down" };
  if (number > 80) return { zone: "hot", pill: "Túlvett", pillClass: "flat" };
  return { zone: "ok", pill: "Normál sáv", pillClass: "" };
}

function donutChart(value, label) {
  const cx = 60;
  const cy = 60;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const finite = value !== null && value !== undefined && Number.isFinite(Number(value));
  const pct = finite ? Math.max(0, Math.min(100, Number(value))) : 0;
  const filled = (pct / 100) * circumference;
  const zone = breadthZone(finite ? Number(value) : NaN);
  const ticks = [20, 80].map((mark) => {
    const angle = (mark / 100) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * 34.5;
    const y1 = cy + Math.sin(angle) * 34.5;
    const x2 = cx + Math.cos(angle) * 49.5;
    const y2 = cy + Math.sin(angle) * 49.5;
    return `<line class="donut-tick" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"></line>`;
  }).join("");
  const arc = finite && pct > 0
    ? `<circle class="donut-value zone-${zone.zone}" cx="${cx}" cy="${cy}" r="${radius}" stroke-dasharray="${filled.toFixed(2)} ${(circumference - filled).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"></circle>`
    : "";
  const text = finite ? `${fmt(value, 1)}%` : "–";
  return `
    <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${esc(label)}: ${esc(text)}">
      <circle class="donut-track" cx="${cx}" cy="${cy}" r="${radius}"></circle>
      ${arc}
      ${ticks}
      <text class="donut-pct num" x="${cx}" y="${cy}">${esc(text)}</text>
    </svg>`;
}

function advanceDeclineBar(breadth) {
  const current = (breadth && breadth.current) || {};
  const block = breadth && breadth.advance_decline;
  let up = current.advances ?? current.advancing ?? current.advance;
  let down = current.declines ?? current.declining ?? current.decline;
  if (block && typeof block === "object" && !Array.isArray(block)) {
    up = block.advances ?? block.advancing ?? block.up ?? up;
    down = block.declines ?? block.declining ?? block.down ?? down;
  }
  up = Number(up);
  down = Number(down);
  if (!Number.isFinite(up) || !Number.isFinite(down) || up + down <= 0) return "";
  const share = Math.max(0, Math.min(100, (up / (up + down)) * 100));
  return `
    <div class="ad-line">
      <div class="ad-top"><span>Emelkedő / csökkenő részvények</span><span class="num">${fmt(up, 0)} / ${fmt(down, 0)}</span></div>
      <div class="ad-bar" aria-hidden="true"><i style="width:${share.toFixed(1)}%"></i></div>
    </div>`;
}

function renderBreadth(breadth) {
  const current = (breadth && breadth.current) || {};
  const history = (breadth && breadth.history) || [];
  const tiles = [
    ["spx50", "S&P 500", "50 napos átlag felett", current.spx50, "Az S&P 500 részvényeinek hány százaléka van a saját 50 napos átlaga felett."],
    ["spx200", "S&P 500", "200 napos átlag felett", current.spx200, "Az S&P 500 részvényeinek hány százaléka van a saját 200 napos átlaga felett."],
    ["ndx50", "Nasdaq-100", "50 napos átlag felett", current.ndx50, "A Nasdaq-100 részvényeinek hány százaléka van a saját 50 napos átlaga felett."],
    ["ndx200", "Nasdaq-100", "200 napos átlag felett", current.ndx200, "A Nasdaq-100 részvényeinek hány százaléka van a saját 200 napos átlaga felett."],
  ];
  const universe = breadth && breadth.universe ? breadth.universe : {};
  const sample = `S&P minta: ${current.spx_n ?? "–"} / ${universe.spx ?? "–"} · Nasdaq-100 minta: ${current.ndx_n ?? "–"} / ${universe.ndx ?? "–"}`;
  const ratios = shownBreadthRatios(breadth);
  const average = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null;
  const oversold = (average !== null && average < 20) || ratios.some((value) => value < 20);
  const oversoldNote = oversold ? `<p class="oversold-note">Túladott piac</p>` : "";
  return `
    <section id="szelesseg">
      <div class="section-head">
        <div>
          <h2>Piaci szélesség</h2>
          <p>Hány részvény van a mozgóátlaga felett. A 20% alatti sáv túladott, a 80% feletti túlvett piacot jelez.</p>
        </div>
        ${statusBadge(breadth)}
      </div>
      <article class="card breadth-card">
        <div class="donut-grid">
          ${tiles.map(([key, name, sub, value, hint]) => {
            const zone = breadthZone(value);
            const delta = weekChange(history, key);
            const week = delta === null ? "" : `<p class="donut-week num ${signClass(delta)}">5 nap ${fmtPp(delta)}</p>`;
            return `
            <div class="donut-tile" title="${esc(hint)}">
              <p class="donut-name">${esc(name)}</p>
              <p class="donut-sub">${esc(sub)}</p>
              ${donutChart(value, `${name} ${sub}`)}
              <p class="donut-pill"><span class="pill ${zone.pillClass}">${esc(zone.pill)}</span></p>
              ${week}
            </div>`;
          }).join("")}
        </div>
        <div class="donut-legend">
          <span><i class="swatch bad"></i>0–20% túladott</span>
          <span><i class="swatch ok"></i>20–80% normál</span>
          <span><i class="swatch hot"></i>80–100% túlvett</span>
          <span class="legend-note">A vékony jelölők a 20% és 80% határt mutatják.</span>
        </div>
        ${advanceDeclineBar(breadth)}
        ${oversoldNote}
      </article>
      <p class="story">${esc(breadthStory(current.spx200))}</p>
      <p class="source">${esc(sample)} · Zárónap: ${formatDay(breadth && breadth.as_of)} · ${esc((breadth && breadth.source) || "")}</p>
    </section>`;
}

function renderSentiment(sentiment) {
  const block = sentiment || {};
  return `
    <section id="hangulat">
      <div class="section-head">
        <div>
          <h2>Volatilitás és hangulat</h2>
          <p>A VIX a várt kilengés, a Fear &amp; Greed és az AAII a hangulat, a put/call pedig azt mutatja, mennyien fedeznek esésre.</p>
        </div>
      </div>
      <div class="grid-3">
        ${renderVix(block.vix)}
        ${renderTerm(block.vix_term)}
        ${renderFear(block.fear_greed)}
        ${renderAaii(block.aaii)}
        ${renderPutCall(block.put_call)}
      </div>
    </section>`;
}

function renderVix(block) {
  if (!block || block.value === null || block.value === undefined) return unavailable("VIX", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>VIX</h3><span>${statusBadge(block)} <span class="badge ${vixClass(block.value)}">${esc(vixWord(block.value))}</span></span></div>
      <div class="price-row">
        <span class="price num">${fmt(block.value, 2)}</span>
        <span class="chg num ${signClass(block.change)}">${fmtPct(block.change_pct)}</span>
      </div>
      <p class="fine">Az S&amp;P 500 opcióiból számolt, 30 napos várt elmozdulás. 15 alatt nyugodt a piac, 20–30 között emelkedett a bizonytalanság, 30 felett már félelem.</p>
      <div class="chart-box spark"><canvas id="chart-vix"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
    </article>`;
}

function renderTerm(block) {
  if (!block || block.vix === null || block.vix === undefined) return unavailable("VIX lejárati szerkezet", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>VIX lejáratok</h3>${statusBadge(block)}</div>
      <div class="term">
        <div><div class="k">9 napos</div><div class="v num">${fmt(block.vix9d, 2)}</div></div>
        <div><div class="k">VIX, 30 nap</div><div class="v num">${fmt(block.vix, 2)}</div></div>
        <div><div class="k">3 hónapos</div><div class="v num">${fmt(block.vix3m, 2)}</div></div>
      </div>
      <p class="story">${esc(structureText(block.structure))} Arány (VIX / 3 hónapos): <span class="num">${fmt(block.ratio, 3)}</span>.</p>
      <div class="chart-box spark"><canvas id="chart-term"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
    </article>`;
}

function fearBadgeClass(label) {
  const text = (label || "").toLowerCase();
  if (text.includes("kapzsi")) return "calm";
  if (text.includes("félelem") || text.includes("felelem")) return "hot";
  return "";
}

function fearLabel(label) {
  const text = (label || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderFear(block) {
  if (!block || block.score === null || block.score === undefined) return unavailable("Fear & Greed", block);
  const left = Math.max(0, Math.min(100, Number(block.score)));
  const label = fearLabel(block.rating_hu);
  return `
    <article class="card">
      <div class="card-kicker"><h3>Fear &amp; Greed</h3>${statusBadge(block)}</div>
      <div class="fg-value">
        <span class="price num">${fmt(block.score, 1)}</span>
        ${label ? `<span class="badge ${fearBadgeClass(label)}">${esc(label)}</span>` : ""}
      </div>
      <div class="meter" aria-hidden="true"><i style="left:${left}%"></i></div>
      <div class="meter-ends"><span>Extrém félelem</span><span>Extrém kapzsiság</span></div>
      <div class="stats">
        <span>Előző záró <b class="num">${fmt(block.previous_close, 1)}</b></span>
        <span>1 hét <b class="num">${fmt(block.previous_week, 1)}</b></span>
        <span>1 hó <b class="num">${fmt(block.previous_month, 1)}</b></span>
        <span>1 év <b class="num">${fmt(block.previous_year, 1)}</b></span>
      </div>
      <p class="fine">Összetett hangulatindex. Az alacsony érték félelmet, a magas kapzsiságot jelent. Önmagában nem kereskedési jel.</p>
      <div class="chart-box spark"><canvas id="chart-fg"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
    </article>`;
}

function renderAaii(block) {
  if (!block || block.bull === null || block.bull === undefined) return unavailable("AAII felmérés", block);
  const avg = block.averages || {};
  return `
    <article class="card">
      <div class="card-kicker"><h3>AAII bika / medve</h3>${statusBadge(block, "weekly")}</div>
      <div class="price-row">
        <span class="price num ${signClass(block.spread)}">${fmtSigned(block.spread, 1, " pp")}</span>
        <span class="chg">bika − medve</span>
      </div>
      <div class="stack" aria-hidden="true">
        <span style="width:${Number(block.bull) || 0}%"></span>
        <span style="width:${Number(block.neutral) || 0}%"></span>
        <span style="width:${Number(block.bear) || 0}%"></span>
      </div>
      <div class="stats">
        <span class="up">Bika <b class="num">${fmt(block.bull, 1)}%</b></span>
        <span>Semleges <b class="num">${fmt(block.neutral, 1)}%</b></span>
        <span class="down">Medve <b class="num">${fmt(block.bear, 1)}%</b></span>
      </div>
      <p class="fine">Amerikai kisbefektetők heti szavazata a következő hat hónapról. Hosszú átlag: bika ${fmt(avg.bull, 1)}%, semleges ${fmt(avg.neutral, 1)}%, medve ${fmt(avg.bear, 1)}%. A szélsőségesen magas medve-arányt sokan túlzott pesszimizmusként olvassák.</p>
      ${(block.history || []).length >= 8 ? '<div class="chart-box spark"><canvas id="chart-aaii"></canvas></div>' : ""}
      <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
    </article>`;
}

function renderPutCall(block) {
  if (!block || block.value === null || block.value === undefined) return unavailable("Put/call arány", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>Put/call</h3><span>${statusBadge(block)} <span class="badge">${esc(putWord(block.value))}</span></span></div>
      <div class="price-row"><span class="price num">${fmt(block.value, 2)}</span></div>
      <p class="fine">A CBOE részvényopciós put és call forgalmának 5 napos átlaga. 0,7 alatt kevés a védelmi vétel, 1 felett a putok vannak többségben, vagyis többen fedeznek esésre.</p>
      <div class="chart-box spark"><canvas id="chart-pc"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
    </article>`;
}

function renderHy(block) {
  if (!block || block.value === null || block.value === undefined) return unavailable("Bóvli kötvényfelár", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>Bóvli kötvényfelár</h3><span>${statusBadge(block, "fred")} <span class="badge">${esc(hyWord(block.value))}</span></span></div>
      <div class="price-row"><span class="price num">${fmt(block.value, 2)}%</span></div>
      <p class="fine">Mennyivel fizet többet az amerikai gyenge besorolású vállalati kötvény az állampapírnál. Táguló felár kockázatkerülést, szűkülő felár kockázatvállalást jelez.</p>
      <div class="chart-box spark"><canvas id="chart-hy"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${esc(block.source || "")}</p>
    </article>`;
}

function renderYields(yields, hy, extras) {
  const current = (yields && yields.current) || {};
  const tiles = [
    ["3 hónap", current.m3, "A legrövidebb, pénzpiaci hozam."],
    ["2 év", current.y2, "A rövid–közepes várakozásokat tükrözi, gyakran a kamatpályát."],
    ["10 év", current.y10, "A hosszú hozam, a jelzálogok és a részvényértékelés gyakori viszonyítási pontja."],
    ["30 év", current.y30, "A görbe leghosszabb, likvidebb vége."],
    ["10 év − 2 év", current.spread, "A görbe meredeksége. Ha negatív, a görbe fordított."],
  ];
  const spreadText = current.spread === null || current.spread === undefined
    ? "A 10 és 2 éves hozam különbsége most nem számolható."
    : current.spread < 0
      ? "A 10 éves hozam a 2 éves alatt van: a görbe fordított. A piac ezt gyakran lassulásként olvassa."
      : "A 10 éves hozam a 2 éves felett van: a görbe a szokásos irányba lejt.";
  return `
    <section id="kamatok">
      <div class="section-head">
        <div>
          <h2>Kamatok, hitel és egyéb piacok</h2>
          <p>Az amerikai hozamgörbe, a bóvli kötvényfelár, valamint a dollár, az arany, az olaj és a bitcoin. Ezek gyakran együtt mozognak a részvénykockázattal.</p>
        </div>
        ${statusBadge(yields, "fred")}
      </div>
      <h3 class="subhead">Amerikai hozamok</h3>
      <div class="yield-row">
        ${tiles.map(([label, value, hint]) => `
          <article class="card kpi" title="${esc(hint)}">
            <div class="label">${esc(label)}</div>
            <div class="value num ${label.startsWith("10 év −") ? signClass(value) : ""}">${fmt(value, 2)}${value === null || value === undefined ? "" : "%"}</div>
          </article>`).join("")}
      </div>
      <p class="story">${esc(spreadText)}</p>
      <div class="yield-charts">
        <article class="card">
          <h3>Hozamok</h3>
          <p class="fine">A futamidők hozama százalékban. Együtt emelkedő görbék szigorodó kamatkörnyezetet, együtt esők enyhülést mutatnak.</p>
          <div class="chart-box mid"><canvas id="chart-yields"></canvas></div>
        </article>
        <article class="card">
          <h3>10 év − 2 év</h3>
          <p class="fine">Nulla alatt a görbe fordított. A vonal a százalékpontos különbség.</p>
          <div class="chart-box mid"><canvas id="chart-spread"></canvas></div>
        </article>
      </div>
      <p class="source">${formatDay(yields && yields.as_of)} · ${esc((yields && yields.source) || "")}</p>
      <h3 class="subhead">Hitelkockázat</h3>
      <div class="solo">${renderHy(hy)}</div>
      <h3 class="subhead">Dollár, nyersanyag, bitcoin</h3>
      <p class="lede">A részvénypiacon kívüli, gyakran együtt figyelt piacok. A százalék a napi változás.</p>
      ${renderExtras(extras)}
    </section>`;
}

function renderExtras(extras) {
  return `
    <div class="grid-quotes">
      ${(extras || []).map(renderQuote).join("")}
    </div>`;
}

function renderSectors(block) {
  const data = block || {};
  const rows = data.sectors || [];
  if (!rows.length) {
    return `
      <section id="szektorok">
        <div class="section-head">
          <div>
            <h2>Szektorok</h2>
            <p>Az S&amp;P 500 tizenegy szektora az utolsó öt kereskedési nap hozama szerint.</p>
          </div>
          ${statusBadge(data)}
        </div>
        ${unavailable("Szektorok", data)}
      </section>`;
  }
  const values = rows.map((row) => Number(row.week_pct)).filter((value) => Number.isFinite(value));
  const max = Math.max(0.4, ...values.map((value) => Math.abs(value)));
  const bench = data.benchmark;
  const benchLine = bench
    ? `<div class="bench num"><span>S&amp;P 500 (SPY)</span><span>1 hét ${fmtPct(bench.week_pct, 2)}</span><span>1 hó ${fmtPct(bench.month_pct, 2)}</span><span>YTD ${fmtPct(bench.ytd_pct, 2)}</span></div>`
    : "";
  const names = (list) => (list || []).map((row) => `${row.name} (${fmtPct(row.week_pct, 2)})`).join(", ");
  const lead = (data.leaders || []).length
    ? `<p class="lead-line">A hét legerősebbjei: ${esc(names(data.leaders))}. A leggyengébbek: ${esc(names(data.laggards))}.</p>`
    : "";
  return `
    <section id="szektorok">
      <div class="section-head">
        <div>
          <h2>Szektorok</h2>
          <p>Az S&amp;P 500 tizenegy szektora, SPDR ETF-eken. A sorrend az utolsó 5 kereskedési nap hozama, a legerősebbtől a leggyengébbig. A vs SPY oszlop ugyanezen a héten a szektor és az S&amp;P 500 ETF hozamának különbsége: a pozitív szám felülteljesítés.</p>
        </div>
        ${statusBadge(data)}
      </div>
      <article class="card sector-card">
        ${benchLine}
        ${lead}
        <div class="sector-head">
          <span>Szektor</span>
          <span>1 hét</span>
          <span>1 hó</span>
          <span>YTD</span>
          <span title="1 hetes hozam mínusz a SPY hozama">vs SPY</span>
        </div>
        ${rows.map((row) => {
          const value = Number(row.week_pct);
          const known = Number.isFinite(value);
          const width = known ? (Math.abs(value) / max) * 50 : 0;
          const side = known && value < 0 ? "down" : "up";
          const role = row.role === "leader" ? "leader" : row.role === "laggard" ? "laggard" : "";
          const pill = row.role === "leader" ? '<span class="pill up">Vezető</span>' : row.role === "laggard" ? '<span class="pill down">Lemaradó</span>' : "";
          const fill = known ? `<i class="s-fill ${side}" style="width:${width.toFixed(2)}%"></i>` : "";
          return `
            <div class="sector-row ${role}" title="${esc(row.name_en || "")}. 1 hó vs SPY: ${fmtSigned(row.month_vs_spy, 2, " pp")}. YTD vs SPY: ${fmtSigned(row.ytd_vs_spy, 2, " pp")}.">
              <div class="s-name">
                <strong>${esc(row.name)}</strong>
                <span class="s-ticker num">${esc(row.ticker)}</span>
                ${pill}
              </div>
              <div class="s-barcell">
                <div class="s-track" aria-hidden="true"><i class="s-zero"></i>${fill}</div>
                <span class="s-week num ${known ? signClass(value) : "flat"}">${known ? fmtPct(value, 2) : "–"}</span>
              </div>
              <div class="s-metric num ${signClass(row.month_pct)}"><span class="s-k">1 hó</span>${fmtPct(row.month_pct, 2)}</div>
              <div class="s-metric num ${signClass(row.ytd_pct)}"><span class="s-k">YTD</span>${fmtPct(row.ytd_pct, 2)}</div>
              <div class="s-metric num ${signClass(row.week_vs_spy)}"><span class="s-k">vs SPY</span>${fmtSigned(row.week_vs_spy, 2, " pp")}</div>
            </div>`;
        }).join("")}
      </article>
      <p class="source">${formatDay(data.as_of)} · ${esc(data.note || data.source || "")}</p>
    </section>`;
}

function renderMover(row) {
  const headline = row.headline || null;
  const href = headline ? safeUrl(headline.url) : "";
  const link = href
    ? `<a class="mover-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span>${esc(headline.source || "")}</span> ${esc(headline.title || "")}</a>`
    : "";
  return `
    <div class="mover-row">
      <span class="mover-ticker num">${esc(row.ticker)}</span>
      <span class="mover-name">${esc(row.name || "")}</span>
      <span class="mover-chg num ${signClass(row.change_pct)}">${fmtPct(row.change_pct, 2)}</span>
      ${link}
    </div>`;
}

function renderMoverColumn(title, rows) {
  if (!rows.length) {
    return `<article class="card"><h3>${esc(title)}</h3><p class="empty">Nincs megjeleníthető papír.</p></article>`;
  }
  return `
    <article class="card mover-card">
      <h3>${esc(title)}</h3>
      ${rows.map(renderMover).join("")}
    </article>`;
}

function budapestTodayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function summaryIsFresh(summary) {
  if (!summary || !Array.isArray(summary.items) || summary.items.length === 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(summary.date || "")) return false;
  const summaryDay = Date.parse(`${summary.date}T00:00:00Z`);
  const today = Date.parse(`${budapestTodayIso()}T00:00:00Z`);
  if (!Number.isFinite(summaryDay) || !Number.isFinite(today)) return false;
  const age = Math.round((today - summaryDay) / 86400000);
  return age >= 0 && age <= 3;
}

function impactClass(impact) {
  if (impact === "pozitív") return "up";
  if (impact === "negatív") return "down";
  return "flat";
}

function impactLabel(impact) {
  if (impact === "pozitív") return "Pozitív";
  if (impact === "negatív") return "Negatív";
  if (impact === "semleges") return "Semleges";
  return "";
}

function renderSummary(summary) {
  if (!summaryIsFresh(summary)) {
    return `<p class="summary-empty">Nincs friss összefoglaló.</p>`;
  }
  const cards = summary.items.map((item) => {
    const href = safeUrl(item.url);
    const tickers = (item.tickers || []).filter(Boolean).map((ticker) => `<span class="badge">${esc(ticker)}</span>`).join("");
    const source = href
      ? `<a class="summary-source" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(item.source || "Forrás")}</a>`
      : `<span class="summary-source">${esc(item.source || "")}</span>`;
    const pill = impactLabel(item.impact);
    return `
      <article class="card summary-card">
        <h3>${esc(item.title || "")}</h3>
        <p class="fine">${esc(item.summary || "")}</p>
        <div class="summary-meta">
          ${pill ? `<span class="pill ${impactClass(item.impact)}">${pill}</span>` : ""}
          ${tickers}
          ${source}
        </div>
      </article>`;
  }).join("");
  return `
    <p class="takeaway">${esc(summary.headline || "")}</p>
    <p class="source">Összefoglaló napja: ${formatDay(summary.date)}</p>
    <div class="summary-grid">${cards}</div>`;
}

function renderNews(block, summary) {
  const data = block || {};
  const movers = data.movers || {};
  const gainers = movers.gainers || [];
  const losers = movers.losers || [];
  const moverBlock = gainers.length || losers.length
    ? `<div class="mover-grid">${renderMoverColumn("Emelkedők", gainers)}${renderMoverColumn("Esők", losers)}</div>`
    : `<p class="empty">A napi elmozdulások most nem számolhatók.</p>`;
  return `
    <section id="hirek">
      <div class="section-head">
        <div>
          <h2>A nap legfontosabb eseményei</h2>
          <p>Rövid, kézi összefoglaló, alatta az S&amp;P 500 és a Nasdaq-100 öt legnagyobb napi emelkedője és esője.</p>
        </div>
        ${statusBadge(data)}
      </div>
      ${renderSummary(summary)}
      <h3 class="subhead">Legnagyobb elmozdulások${movers.as_of ? ` · ${formatDay(movers.as_of)}` : ""}</h3>
      ${moverBlock}
      <p class="source">${esc(data.source || "")}</p>
    </section>`;
}

function drawSeries(id, history, key, colorRole, digits, suffix, label) {
  const series = lineData(history, key);
  const canvas = document.getElementById(id);
  if (!canvas || series.values.length < 2) return;
  mountChart(canvas, {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [{
        label: label || key,
        data: series.values,
        colorRole,
        borderColor: cssVar(colorRole),
        digits,
        suffix,
      }],
    },
    options: sparkOptions(),
  });
}

function drawSentiment(sentiment) {
  const block = sentiment || {};
  if (block.vix) drawSeries("chart-vix", block.vix.history, "value", "--c4", 2, "", "VIX");
  const term = (block.vix_term && block.vix_term.history) || [];
  const termCanvas = document.getElementById("chart-term");
  if (termCanvas && term.length > 1) {
    mountChart(termCanvas, {
      type: "line",
      data: {
        labels: term.map((row) => row.date),
        datasets: [
          { label: "9 napos", data: term.map((row) => row.vix9d), colorRole: "--c1", borderColor: cssVar("--c1"), digits: 2, spanGaps: true },
          { label: "VIX", data: term.map((row) => row.vix), colorRole: "--c4", borderColor: cssVar("--c4"), digits: 2, spanGaps: true },
          { label: "3 hónapos", data: term.map((row) => row.vix3m), colorRole: "--c5", borderColor: cssVar("--c5"), digits: 2, spanGaps: true },
        ],
      },
      options: sparkOptions(),
    });
  }
  if (block.fear_greed) drawSeries("chart-fg", block.fear_greed.history, "score", "--c3", 1, "", "Fear & Greed");
  const aaii = (block.aaii && block.aaii.history) || [];
  const aaiiCanvas = document.getElementById("chart-aaii");
  if (aaiiCanvas && aaii.length > 1) {
    mountChart(aaiiCanvas, {
      type: "line",
      data: {
        labels: aaii.map((row) => row.date),
        datasets: [
          { label: "Bika", data: aaii.map((row) => row.bull), colorRole: "--up", borderColor: cssVar("--up"), digits: 1, suffix: "%" },
          { label: "Medve", data: aaii.map((row) => row.bear), colorRole: "--down", borderColor: cssVar("--down"), digits: 1, suffix: "%" },
        ],
      },
      options: sparkOptions(),
    });
  }
  if (block.put_call) drawSeries("chart-pc", block.put_call.history, "value", "--c1", 2, "", "Put/call");
  if (block.hy_spread) drawSeries("chart-hy", block.hy_spread.history, "value", "--c3", 2, "%", "Felár");
}

function lastYear(history) {
  return (history || []).slice(-252);
}

function drawSpark(item) {
  const canvas = document.getElementById(`spark-${item.id}`);
  const rows = lastYear(item.history);
  if (!canvas || rows.length < 2) return;
  const rising = rows[rows.length - 1].close >= rows[0].close;
  mountChart(canvas, {
    type: "line",
    data: {
      labels: rows.map((row) => row.date),
      datasets: [{
        label: item.name,
        data: rows.map((row) => row.close),
        colorRole: "updown",
        rising,
        borderColor: rising ? cssVar("--up") : cssVar("--down"),
        digits: item.digits ?? 2,
      }],
    },
    options: sparkOptions(),
  });
}

function drawCompare(indices) {
  const anchor = (indices || []).find((item) => item.id === "spx" && item.history && item.history.length);
  const canvas = document.getElementById("chart-compare");
  if (!anchor || !canvas) return;
  const dates = lastYear(anchor.history).map((row) => row.date);
  const roles = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];
  const datasets = indices.filter((item) => item.history && item.history.length).map((item, index) => {
    const map = new Map(item.history.map((row) => [row.date, row.close]));
    const raw = dates.map((day) => map.get(day) ?? null);
    const base = raw.find((value) => value !== null && value !== undefined);
    const role = roles[index % roles.length];
    return {
      label: item.name,
      data: raw.map((value) => (value === null || !base ? null : (value / base) * 100)),
      colorRole: role,
      borderColor: cssVar(role),
      spanGaps: true,
      digits: 1,
    };
  });
  mountChart(canvas, {
    type: "line",
    data: { labels: dates, datasets },
    options: baseOptions({
      plugins: {
        ...baseOptions().plugins,
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            pointStyle: "circle",
            color: cssVar("--muted"),
            padding: 14,
            font: { size: 12 },
          },
        },
      },
    }),
  });
}

function drawYields(yields) {
  const history = (yields && yields.history) || [];
  const yieldCanvas = document.getElementById("chart-yields");
  const spreadCanvas = document.getElementById("chart-spread");
  if (history.length < 2 || !yieldCanvas || !spreadCanvas) return;
  const labels = history.map((row) => row.date);
  const series = [
    ["m3", "3 hónap", "--c6"],
    ["y2", "2 év", "--c1"],
    ["y10", "10 év", "--c3"],
    ["y30", "30 év", "--c4"],
  ];
  mountChart(yieldCanvas, {
    type: "line",
    data: {
      labels,
      datasets: series.map(([key, label, role]) => ({
        label,
        data: history.map((row) => row[key]),
        colorRole: role,
        borderColor: cssVar(role),
        spanGaps: true,
        digits: 2,
        suffix: "%",
      })),
    },
    options: baseOptions({
      plugins: {
        ...baseOptions().plugins,
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            pointStyle: "circle",
            color: cssVar("--muted"),
            padding: 12,
            font: { size: 12 },
          },
        },
      },
    }),
  });
  mountChart(spreadCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "10 év − 2 év",
          data: history.map((row) => row.spread),
          colorRole: "--c5",
          borderColor: cssVar("--c5"),
          spanGaps: true,
          digits: 2,
          suffix: " pp",
        },
        {
          label: "nulla",
          data: history.map(() => 0),
          colorRole: "zero",
          borderColor: cssVar("--chart-zero"),
          borderDash: [4, 4],
          pointRadius: 0,
          digits: 0,
        },
      ],
    },
    options: baseOptions({
      plugins: {
        ...baseOptions().plugins,
        legend: {
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            pointStyle: "circle",
            color: cssVar("--muted"),
            filter: (item) => item.text !== "nulla",
          },
        },
      },
    }),
  });
}

function keyFailures(data) {
  const sentiment = data.sentiment || {};
  const spx = (data.indices || []).find((item) => item.id === "spx");
  const blocks = [
    ["Kereskedési pontszám", data.trading_score, "equity"],
    ["Nasdaq trendszűrő", data.nasdaq_trend, "equity"],
    ["Szélesség", data.breadth, "equity"],
    ["VIX", sentiment.vix, "equity"],
    ["Fear & Greed", sentiment.fear_greed, "equity"],
    ["Hozamok", data.yields, "fred"],
    ["Bóvli felár", sentiment.hy_spread, "fred"],
    ["S&P 500", spx, "equity"],
  ];
  return blocks.filter(([, block, kind]) => {
    const state = freshness(block, kind);
    return state === "stale" || state === "unavailable";
  });
}

function render(data, summary) {
  const failed = keyFailures(data);
  const banner = failed.length >= 3
    ? `<div class="alert">Több fontos forrás nem elérhető vagy elavult (${failed.map(([name]) => esc(name)).join(", ")}). Ahol van korábbi érték, azt mutatjuk a dátumával.</div>`
    : "";
  const sentiment = data.sentiment || {};
  document.getElementById("app").innerHTML = `
    ${banner}
    ${renderTradingScore(data.trading_score, data.breadth, sentiment)}
    ${renderIndices(data.indices || [], data.nasdaq_trend)}
    ${renderBreadth(data.breadth)}
    ${renderSentiment(sentiment)}
    ${renderYields(data.yields, sentiment.hy_spread, data.extras || [])}
    ${renderSectors(data.sectors)}
    ${renderNews(data.news, summary)}
  `;
  drawSentiment(sentiment);
  (data.indices || []).forEach(drawSpark);
  (data.extras || []).forEach(drawSpark);
  drawCompare(data.indices || []);
  drawYields(data.yields);
}

function renderHeader(meta) {
  const box = document.getElementById("updated");
  const stamp = meta.generated_at_budapest || "–";
  box.innerHTML = `
    <p class="eyebrow">Budapest</p>
    <p class="stamp">${esc(stamp)} <span>· piaci nap ${formatDay(meta.market_date)}</span></p>`;
  const footer = document.getElementById("footer-updated");
  if (footer) {
    footer.textContent = `Utolsó frissítés: ${stamp} (${meta.timezone || "Europe/Budapest"}). Piaci nap: ${formatDay(meta.market_date)}`;
  }
}

async function main() {
  const app = document.getElementById("app");
  try {
    const version = document.querySelector('meta[name="asset-version"]')?.content || "";
    const dataUrl = (path) => (version ? `${path}?v=${encodeURIComponent(version)}` : path);
    const [response, summaryResponse] = await Promise.all([
      fetch(dataUrl("data/dashboard.json"), { cache: "no-store" }),
      fetch(dataUrl("data/news_summary.json"), { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("A dashboard.json nem tölthető be.");
    const data = await response.json();
    let summary = null;
    if (summaryResponse.ok) {
      try {
        summary = await summaryResponse.json();
      } catch (error) {
        summary = null;
      }
    }
    renderHeader(data.meta || {});
    render(data, summary);
  } catch (error) {
    app.innerHTML = `<p class="error-banner">Az adatfájl nem olvasható. Futtasd a <span class="num">python scripts/fetch_data.py</span> parancsot, majd frissítsd az oldalt.</p>`;
  }
}

if (typeof Chart !== "undefined") {
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
  Chart.defaults.color = cssVar("--chart-tick");
}

syncThemeControls();
document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  setTheme(next);
});

main();
