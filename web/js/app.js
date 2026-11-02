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

function statusBadge(block) {
  if (!block || block.status === "ok") return "";
  if (block.status === "stale") {
    return `<span class="badge stale" title="A forrás most nem válaszolt, az utolsó sikeres értéket mutatjuk.">Utolsó ismert adat · ${formatDay(block.as_of)}</span>`;
  }
  return `<span class="badge bad" title="Ehhez a mutatóhoz még nincs megjeleníthető adat.">Nem elérhető</span>`;
}

function unavailable(title, block) {
  const why = block && block.error ? " A forrás nem válaszolt, és nincs korábbi érték." : "";
  return `<article class="card"><h3>${esc(title)}</h3><p class="empty">Ez a mutató most nem elérhető.${esc(why)}</p></article>`;
}

function breadthWord(value) {
  if (value === null || value === undefined) return "nincs adat";
  if (value >= 80) return "nagyon széles";
  if (value >= 60) return "széles emelkedés";
  if (value >= 40) return "vegyes";
  if (value >= 20) return "szűk piac";
  return "széles gyengeség";
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
  if (meta) meta.setAttribute("content", theme === "dark" ? "#09090b" : "#f5f5f7");
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

function scoreSpark(history, tone) {
  const rows = (history || []).filter((row) => row.score !== null && row.score !== undefined);
  if (rows.length < 2) return "";
  const values = rows.map((row) => Number(row.score));
  const width = 320;
  const height = 72;
  const pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(8, max - min);
  const low = Math.max(0, min - span * 0.18);
  const high = Math.min(100, max + span * 0.18);
  const range = Math.max(1, high - low);
  const coords = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (value - low) / range) * (height - pad * 2);
    return [x, y];
  });
  const line = coords.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];
  const area = `${line} L${last[0].toFixed(1)} ${height - pad} L${first[0].toFixed(1)} ${height - pad} Z`;
  return `
    <div class="spark-block">
      <svg class="score-spark tone-${esc(tone)}" viewBox="0 0 ${width} ${height}" role="img" aria-label="A kereskedési pontszám az utolsó ${rows.length} kereskedési napon ${fmt(min, 0)} és ${fmt(max, 0)} között mozgott">
        <path class="spark-area" d="${area}"></path>
        <path class="spark-line" d="${line}"></path>
        <circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5"></circle>
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
        <ul>
          <li><b>Nasdaq-trend, 35%.</b> Teljes kockázat, ha a záróár a 9 és a 20 napos EMA, valamint az 50 és a 200 napos SMA felett van: 100 pont. Fél kockázat: 50 pont, plusz 10, ha az utolsó 5 kereskedési napon a 9 napos EMA alulról keresztezte a 20 naposat. A 20 napos EMA alatt: 0 pont.</li>
          <li><b>Piaci szélesség, 25%.</b> Az S&amp;P 500 és a Nasdaq-100 50 és 200 napos átlag feletti négy arány átlaga. 20% → 0 pont, 70% → 100 pont, közte egyenes: (átlag − 20) / 50 × 100. A tartományon kívül a pont 0 vagy 100.</li>
          <li><b>Volatilitás, 20%.</b> VIX 15 vagy alatta: 100 pont, 30 vagy felette: 0, közte egyenes. Ha a 30 napos VIX a 3 hónapos VIX felett van: −20 pont.</li>
          <li><b>Hitelkockázat, 10%.</b> A bóvli felár szintje: 3% vagy alatta 100, 8% vagy felette 0. A 20 napos változás: −0,5 százalékpont 100, +0,5 százalékpont 0. A rész 60% szint + 40% változás. Ha a változás hiányzik, csak a szint számít.</li>
          <li><b>Hangulat, 10%.</b> 40 + 0,5 × a CNN Fear &amp; Greed index. Az extrém félelem (0) 40 pont, az extrém kapzsiság (100) 90 pont.</li>
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
  let read = "a részvények nagy része a hosszú átlag alatt van";
  if (average >= 70) read = "széles, erős emelkedés";
  else if (average >= 55) read = "közepesen erős piac";
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
  let read = "erős kapzsiság, a piac feszített";
  if (fg < 25) read = "erős félelem, a befektetők nagyon óvatosak";
  else if (fg < 45) read = "a piac fél, nem kapzsi";
  else if (fg < 55) read = "a hangulat semleges";
  else if (fg < 75) read = "a hangulat inkább optimista";
  return `A Fear & Greed ${fmt(fg, 0)}: ${read}.`;
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

function renderTradingScore(block) {
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
          </div>
          <div class="score-side">
            ${scoreSpark(block.history, tone)}
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

function renderBreadth(breadth) {
  const current = (breadth && breadth.current) || {};
  const history = (breadth && breadth.history) || [];
  const tiles = [
    ["spx50", "S&P 500 · 50 napos", current.spx50, "Rövidebb trend: az S&P 500 részvényeinek hány százaléka van a saját 50 napos átlaga felett."],
    ["spx200", "S&P 500 · 200 napos", current.spx200, "Hosszabb trend: az S&P 500 részvényeinek hány százaléka van a saját 200 napos átlaga felett."],
    ["ndx50", "Nasdaq-100 · 50 napos", current.ndx50, "A Nasdaq-100 részvényeinek hány százaléka van a saját 50 napos átlaga felett."],
    ["ndx200", "Nasdaq-100 · 200 napos", current.ndx200, "A Nasdaq-100 részvényeinek hány százaléka van a saját 200 napos átlaga felett."],
  ];
  const universe = breadth && breadth.universe ? breadth.universe : {};
  const sample = `S&P minta: ${current.spx_n ?? "–"} / ${universe.spx ?? "–"} · Nasdaq-100 minta: ${current.ndx_n ?? "–"} / ${universe.ndx ?? "–"}`;
  return `
    <section id="szelesseg">
      <div class="section-head">
        <div>
          <h2>Piaci szélesség</h2>
          <p>Hány százalékuk zár a saját mozgóátlaga felett az index részvényeinek. A magas szám széles emelkedést jelent. Alacsony számnál az indexet kevés nagy papír tarthatja, miközben a többség gyenge.</p>
        </div>
        ${statusBadge(breadth)}
      </div>
      <div class="grid-4">
        ${tiles.map(([key, label, value, hint]) => {
          const delta = weekChange(history, key);
          const week = delta === null ? "" : `<p class="week num ${signClass(delta)}">5 kereskedési napja ${fmtPp(delta)}</p>`;
          const shown = value === null || value === undefined ? "–" : `${fmt(value, 1)}%`;
          return `
          <article class="card kpi" title="${esc(hint)}">
            <div class="label"><span>${esc(label)}</span></div>
            <div class="value num">${shown}</div>
            <p class="hint">${breadthWord(value)}</p>
            ${week}
          </article>`;
        }).join("")}
      </div>
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

function renderFear(block) {
  if (!block || block.score === null || block.score === undefined) return unavailable("Fear & Greed", block);
  const left = Math.max(0, Math.min(100, Number(block.score)));
  return `
    <article class="card">
      <div class="card-kicker"><h3>Fear &amp; Greed</h3>${statusBadge(block)}</div>
      <div class="price-row">
        <span class="price num">${fmt(block.score, 1)}</span>
        <span class="chg">${esc(block.rating_hu || "")}</span>
      </div>
      <div class="meter" title="0 extrém félelem, 100 extrém kapzsiság." aria-hidden="true"><i style="left:${left}%"></i></div>
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
      <div class="card-kicker"><h3>AAII bika / medve</h3>${statusBadge(block)}</div>
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
      <div class="card-kicker"><h3>Bóvli kötvényfelár</h3><span>${statusBadge(block)} <span class="badge">${esc(hyWord(block.value))}</span></span></div>
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
        ${statusBadge(yields)}
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

function renderNews(block) {
  const data = block || {};
  const items = data.items || [];
  const failed = (data.feeds || []).filter((feed) => feed.status && feed.status !== "ok");
  const reuters = (data.feeds || []).find((feed) => feed.id === "reuters" && feed.note);
  const failLine = failed.length
    ? `<p class="note">Most nem válaszolt: ${esc([...new Set(failed.map((feed) => feed.name))].join(", "))}.</p>`
    : "";
  const reutersLine = reuters
    ? `<p class="note">A Reuters saját hírcsatornája kulcs nélkül nem elérhető, ezért ezek a címek a Google News reuters.com-ra szűrt folyamából jönnek.</p>`
    : "";
  const body = items.length
    ? `<div class="news-grid">${items.map((item) => {
        const href = safeUrl(item.url);
        const meta = `${esc(item.source || "")} · ${esc(ago(item.published_at))} · ${esc(item.published_budapest || "")}`;
        if (!href) {
          return `<div class="news-item"><span class="news-title">${esc(item.title)}</span><span class="news-meta">${meta}</span></div>`;
        }
        return `<a class="news-item" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span class="news-title">${esc(item.title)}</span><span class="news-meta"><span class="src">${esc(item.source || "")}</span> · ${esc(ago(item.published_at))} · ${esc(item.published_budapest || "")}</span></a>`;
      }).join("")}</div>`
    : unavailable("Napi hírek", data);
  return `
    <section id="hirek">
      <div class="section-head">
        <div>
          <h2>Napi hírek</h2>
          <p>Fontosabb piaci címek az elmúlt ${data.window_hours || 36} órából. A cím eredeti nyelvén látszik, az idő Európa/Budapest szerint.</p>
        </div>
        ${statusBadge(data)}
      </div>
      ${body}
      ${failLine}
      ${reutersLine}
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

function problems(data) {
  const sentiment = data.sentiment || {};
  const blocks = [
    ["Kereskedési pontszám", data.trading_score],
    ["Nasdaq trendszűrő", data.nasdaq_trend],
    ["Szélesség", data.breadth],
    ["VIX", sentiment.vix],
    ["VIX lejárat", sentiment.vix_term],
    ["Fear & Greed", sentiment.fear_greed],
    ["AAII", sentiment.aaii],
    ["Put/call", sentiment.put_call],
    ["Bóvli felár", sentiment.hy_spread],
    ["Hozamok", data.yields],
    ["Szektorok", data.sectors],
    ["Hírek", data.news],
    ...(data.indices || []).map((item) => [item.name, item]),
    ...(data.extras || []).map((item) => [item.name, item]),
  ];
  return blocks.filter(([, block]) => block && block.status && block.status !== "ok");
}

function render(data) {
  const issues = problems(data);
  const banner = issues.length
    ? `<div class="alert">Nem minden forrás frissült (${issues.map(([name, block]) => `${esc(name)}: ${block.status === "stale" ? "utolsó ismert adat" : "nem elérhető"}`).join(", ")}). Ahol van korábbi jó érték, azt mutatjuk a dátumával.</div>`
    : "";
  const sentiment = data.sentiment || {};
  document.getElementById("app").innerHTML = `
    ${banner}
    ${renderTradingScore(data.trading_score)}
    ${renderIndices(data.indices || [], data.nasdaq_trend)}
    ${renderBreadth(data.breadth)}
    ${renderSentiment(sentiment)}
    ${renderYields(data.yields, sentiment.hy_spread, data.extras || [])}
    ${renderSectors(data.sectors)}
    ${renderNews(data.news)}
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
    footer.textContent = `Utolsó frissítés: ${stamp} (${meta.timezone || "Europe/Budapest"}). Piaci nap: ${formatDay(meta.market_date)}.`;
  }
}

async function main() {
  const app = document.getElementById("app");
  try {
    const response = await fetch("data/dashboard.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("A dashboard.json nem tölthető be.");
    const data = await response.json();
    renderHeader(data.meta || {});
    render(data);
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
