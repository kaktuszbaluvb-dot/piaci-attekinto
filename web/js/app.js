const COLORS = {
  spx200: "#7eb6ff",
  spx50: "#b9a6ff",
  ndx200: "#3dcf8e",
  ndx50: "#e2b657",
  vix: "#ff8b6a",
  vix9d: "#7eb6ff",
  vix3m: "#b9a6ff",
  fg: "#e2b657",
  bull: "#3dcf8e",
  bear: "#ff6b7d",
  put: "#7eb6ff",
  hy: "#e2b657",
  m3: "#8ea0b5",
  y2: "#7eb6ff",
  y10: "#e2b657",
  y30: "#ff8b6a",
  spread: "#b9a6ff",
};

const INDEX_COLORS = ["#7eb6ff", "#3dcf8e", "#e2b657", "#ff8b6a", "#b9a6ff", "#f0a3c2", "#9ad7c4"];

const charts = [];

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  return new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function fmtPct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "–";
  const body = fmt(Math.abs(value), digits);
  if (value > 0) return `+${body}%`;
  if (value < 0) return `−${body}%`;
  return `${body}%`;
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
  const body = fmt(Math.abs(value), 1);
  if (value > 0) return `+${body} pp`;
  if (value < 0) return `−${body} pp`;
  return `${body} pp`;
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
  const [year, month, day] = iso.split("-");
  return `${year}. ${month}. ${day}.`;
}

function statusBadge(block) {
  if (!block || block.status === "ok") return "";
  if (block.status === "stale") {
    return `<span class="badge stale">Utolsó ismert adat · ${formatDay(block.as_of)}</span>`;
  }
  return `<span class="badge bad">Nem elérhető</span>`;
}

function unavailable(title, block) {
  return `<article class="card"><h3>${title}</h3><p class="empty">Ez a mutató most nem elérhető. ${block && block.error ? "A forrás nem válaszolt." : ""}</p></article>`;
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
  if (value >= 80) return "A piac nagyon széles és feszített: a részvények túlnyomó része a hosszú átlag felett van.";
  if (value >= 60) return "Széles emelkedés: a többség a saját 200 napos átlaga felett forog.";
  if (value >= 40) return "Vegyes kép: a részvények körülbelül fele van a hosszú átlag felett.";
  if (value >= 20) return "Szűk piac: a részvények többsége a hosszú átlag alatt van.";
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
    return "Contango: a három hónapos VIX magasabb a spotnál, a piac nem áraz közeli sokkot.";
  }
  if (structure === "backwardation") {
    return "Backwardation: a rövid távú félelem drágább a három hónaposnál. Ez stresszes környezet.";
  }
  if (structure === "flat") return "A VIX görbe lapos: nincs erős rövid távú stresszfelár.";
  return "A lejárati szerkezet most nem ítélhető meg.";
}

function putWord(value) {
  if (value === null || value === undefined) return "";
  if (value < 0.7) return "optimista";
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

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 10, boxHeight: 10, color: "#8ea0b5" } },
      tooltip: {
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
        ticks: { maxTicksLimit: 6, color: "#64788c" },
        grid: { display: false },
      },
      y: {
        grace: "8%",
        ticks: { color: "#64788c" },
        grid: { color: "rgba(232,238,246,0.06)" },
      },
    },
    elements: { point: { radius: 0, hitRadius: 8 }, line: { tension: 0.15, borderWidth: 2 } },
    ...extra,
  };
}

function mountChart(canvas, config) {
  if (!canvas || typeof Chart === "undefined") return;
  try {
    charts.push(new Chart(canvas, config));
  } catch (error) {
    console.error(error);
  }
}

function lineData(history, key) {
  const rows = (history || []).filter((row) => row[key] !== null && row[key] !== undefined);
  return {
    labels: rows.map((row) => row.date),
    values: rows.map((row) => row[key]),
  };
}

function scoreSpark(history, tone) {
  const rows = (history || []).filter((row) => row.score !== null && row.score !== undefined);
  if (rows.length < 2) return "";
  const values = rows.map((row) => Number(row.score));
  const width = 320;
  const height = 78;
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
  const color = tone === "bad" ? "#ff6b7d" : tone === "warn" ? "#e2b657" : "#3dcf8e";
  return `
    <div class="spark-block">
      <svg class="score-spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="A kereskedési pontszám az utolsó ${rows.length} kereskedési napon ${fmt(min, 0)} és ${fmt(max, 0)} között mozgott">
        <path d="${area}" fill="${color}" opacity="0.16"></path>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"></circle>
      </svg>
      <p class="spark-caption">Utolsó ${rows.length} kereskedési nap · ${formatDay(rows[0].date)} – ${formatDay(rows[rows.length - 1].date)} · ${fmt(min, 0)}–${fmt(max, 0)}</p>
    </div>`;
}

function renderScorePart(part, renormalized) {
  const missing = !part.available || part.score === null || part.score === undefined;
  const width = missing ? 0 : Math.max(0, Math.min(100, Number(part.score)));
  const tone = part.tone || "";
  return `
    <div class="part${missing ? " is-missing" : ""}">
      <div class="part-top">
        <span class="part-name">${part.label || part.id}</span>
        <span class="part-meta num"><span>${missing ? "–" : fmtScore(part.score)}</span><span>${weightLabel(part, renormalized)}</span></span>
      </div>
      <div class="bar" aria-hidden="true"><i class="tone-${tone}" style="width:${width}%"></i></div>
      <p class="part-detail">${part.detail || part.reason || ""}</p>
    </div>`;
}

function renderTradingScore(block) {
  if (!block || block.score === null || block.score === undefined) {
    return unavailable("Kereskedési pontszám", block);
  }
  const tone = block.tone || "good";
  const parts = block.components || [];
  const missing = block.missing || [];
  const missingLine = missing.length
    ? `<p class="missing-note">Hiányzó rész: ${missing.join(", ")}. A súlyok a rendelkezésre álló részekre vannak normálva.</p>`
    : "";
  return `
    <section class="score-section">
      <article class="card score-card tone-${tone}">
        <div class="score-layout">
          <div class="score-main">
            <div class="score-kicker">
              <h2>Kereskedési pontszám</h2>
              ${statusBadge(block)}
            </div>
            <p class="score-lead">Trendkövető long swinghez, nem kontrariánus jelzés.</p>
            <div class="score-figure">
              <span class="score-num num tone-${tone}">${fmt(block.score, 0)}</span>
              <span class="score-of">/ 100</span>
            </div>
            <p class="verdict tone-${tone}">${block.verdict || ""}</p>
            <div class="band-wrap" aria-hidden="true">
              <div class="band">
                <i class="b-bad"></i><i class="b-warn"></i><i class="b-good"></i><i class="b-strong"></i>
              </div>
              <em class="band-mark" style="left:${Math.max(0, Math.min(100, Number(block.score)))}%"></em>
            </div>
            <div class="band-labels num"><span>0</span><span>40</span><span>60</span><span>80</span><span>100</span></div>
            <p class="method">${block.method || ""}</p>
          </div>
          <div class="score-side">
            ${scoreSpark(block.history, tone)}
            ${missingLine}
            <div class="parts">
              ${parts.map((part) => renderScorePart(part, block.renormalized)).join("")}
            </div>
          </div>
        </div>
        <p class="source">${formatDay(block.as_of)} · ${block.source || ""}</p>
      </article>
    </section>`;
}

function maState(state) {
  if (state === "above") return { text: "Felette", cls: "up" };
  if (state === "below") return { text: "Alatta", cls: "down" };
  return { text: "Rajta", cls: "flat" };
}

function renderAverage(item) {
  const state = maState(item.state);
  return `
    <article class="ma-tile ${item.state || ""}">
      <div class="ma-kicker"><span>${item.label}</span><span class="pill ${state.cls}">${state.text}</span></div>
      <div class="ma-value num">${fmt(item.value, 2)}</div>
      <div class="ma-dist num ${state.cls}">${fmtPct(item.distance_pct, 1)}</div>
      <p class="ma-sub">távolság a záróártól</p>
    </article>`;
}

function renderCross(trend) {
  const down = trend.last_down_cross ? formatDay(trend.last_down_cross) : "nincs a tárolt időszakban";
  if (trend.fresh_up_cross && trend.fresh_up_cross_date) {
    return `
      <div class="cross-fresh">Trend eleje: 9-es EMA felfelé keresztezte a 20-ast (${formatDay(trend.fresh_up_cross_date)})</div>
      <p class="cross-quiet">Utolsó lefelé keresztezés: ${down}</p>`;
  }
  const up = trend.last_up_cross ? formatDay(trend.last_up_cross) : "nincs a tárolt időszakban";
  return `<p class="cross-quiet">Utolsó felfelé keresztezés: ${up} Utolsó lefelé keresztezés: ${down}</p>`;
}

function renderNasdaqTrend(trend) {
  if (!trend || trend.close === null || trend.close === undefined || !trend.regime_label) {
    return unavailable("Nasdaq trendszűrő (Qullamaggie)", trend);
  }
  const tone = trend.regime_tone || "warn";
  return `
    <section class="nasdaq-section">
      <div class="section-head">
        <div>
          <h2>Nasdaq trendszűrő (Qullamaggie)</h2>
          <p>A Nasdaq Composite (^IXIC) záróára. A 9 és a 20 napos átlag exponenciális (EMA), az 50 és a 200 napos egyszerű (SMA).</p>
        </div>
        ${statusBadge(trend)}
      </div>
      <article class="card nasdaq-card">
        <div class="nasdaq-top">
          <div>
            <p class="eyebrow">Záróár · ${formatDay(trend.as_of)}</p>
            <p class="nasdaq-close num">${fmt(trend.close, 2)}</p>
          </div>
          <p class="regime tone-${tone}">${trend.regime_label}</p>
        </div>
        ${trend.regime_note ? `<p class="regime-note">${trend.regime_note}</p>` : ""}
        <div class="ma-grid">
          ${(trend.averages || []).map(renderAverage).join("")}
        </div>
        ${renderCross(trend)}
        <p class="source">Részpont a kereskedési pontszámban: <span class="num">${fmtScore(trend.subscore)}</span> / 100 · ${trend.source || ""}</p>
      </article>
    </section>`;
}

function renderBreadth(breadth) {
  const current = breadth.current || {};
  const history = breadth.history || [];
  const tiles = [
    ["spx50", "S&P 500 · 50 napos", current.spx50, COLORS.spx50],
    ["spx200", "S&P 500 · 200 napos", current.spx200, COLORS.spx200],
    ["ndx50", "Nasdaq-100 · 50 napos", current.ndx50, COLORS.ndx50],
    ["ndx200", "Nasdaq-100 · 200 napos", current.ndx200, COLORS.ndx200],
  ];
  const sample = `S&P minta: ${current.spx_n ?? "–"} / ${breadth.universe ? breadth.universe.spx : "–"} · Nasdaq-100 minta: ${current.ndx_n ?? "–"} / ${breadth.universe ? breadth.universe.ndx : "–"}`;
  return `
    <section>
      <div class="section-head">
        <div>
          <h2>Piaci szélesség</h2>
          <p>A részvények hány százaléka forog a saját 50 és 200 napos átlaga felett.</p>
        </div>
        ${statusBadge(breadth)}
      </div>
      <div class="grid-4">
        ${tiles.map(([key, label, value, color]) => {
          const delta = weekChange(history, key);
          const week = delta === null ? "" : `<p class="week num ${signClass(delta)}">5 kereskedési napja ${fmtPp(delta)}</p>`;
          return `
          <article class="card kpi">
            <div class="label"><span>${label}</span><i class="dot" style="background:${color}"></i></div>
            <div class="value num">${value === null || value === undefined ? "–" : fmt(value, 1) + "%"}</div>
            <p class="hint">${breadthWord(value)}</p>
            ${week}
          </article>`;
        }).join("")}
      </div>
      <p class="story">${breadthStory(current.spx200)}</p>
      <p class="source">${sample} · Zárónap: ${formatDay(breadth.as_of)} · ${breadth.source || ""}</p>
    </section>`;
}

function renderSentiment(sentiment) {
  return `
    <section>
      <div class="section-head">
        <div>
          <h2>Hangulat</h2>
          <p>Félelem, opciós védelem és a lakossági felmérés.</p>
        </div>
      </div>
      <div class="grid-3">
        ${renderVix(sentiment.vix)}
        ${renderTerm(sentiment.vix_term)}
        ${renderFear(sentiment.fear_greed)}
        ${renderAaii(sentiment.aaii)}
        ${renderPutCall(sentiment.put_call)}
        ${renderHy(sentiment.hy_spread)}
      </div>
    </section>`;
}

function renderVix(block) {
  if (!block || block.value === null || block.value === undefined) return unavailable("VIX", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>VIX</h3>${statusBadge(block)} <span class="badge ${vixClass(block.value)}">${vixWord(block.value)}</span></div>
      <div class="price-row">
        <span class="price num">${fmt(block.value, 2)}</span>
        <span class="chg num ${signClass(block.change)}">${fmtPct(block.change_pct)}</span>
      </div>
      <p class="fine">A piac 30 napos, opciókból számolt bizonytalansága. 20 alatt nyugodt, 30 felett már félelem.</p>
      <div class="chart-box spark"><canvas id="chart-vix"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${block.source || ""}</p>
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
      <p class="story">${structureText(block.structure)} Arány (VIX / VIX3M): <span class="num">${fmt(block.ratio, 3)}</span>.</p>
      <div class="chart-box spark"><canvas id="chart-term"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${block.source || ""}</p>
    </article>`;
}

function renderFear(block) {
  if (!block || block.score === null || block.score === undefined) return unavailable("Fear & Greed", block);
  const left = Math.max(0, Math.min(100, Number(block.score)));
  return `
    <article class="card">
      <div class="card-kicker"><h3>Fear & Greed</h3>${statusBadge(block)}</div>
      <div class="price-row">
        <span class="price num">${fmt(block.score, 1)}</span>
        <span class="chg">${block.rating_hu || ""}</span>
      </div>
      <div class="meter" aria-hidden="true"><i style="left:${left}%"></i></div>
      <div class="stats">
        <span>Előző záró <b class="num">${fmt(block.previous_close, 1)}</b></span>
        <span>1 hét <b class="num">${fmt(block.previous_week, 1)}</b></span>
        <span>1 hó <b class="num">${fmt(block.previous_month, 1)}</b></span>
        <span>1 év <b class="num">${fmt(block.previous_year, 1)}</b></span>
      </div>
      <div class="chart-box spark"><canvas id="chart-fg"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${block.source || ""} · 0 félelem, 100 kapzsiság</p>
    </article>`;
}

function renderAaii(block) {
  if (!block || block.bull === null || block.bull === undefined) return unavailable("AAII felmérés", block);
  const avg = block.averages || {};
  return `
    <article class="card">
      <div class="card-kicker"><h3>AAII bika / medve</h3>${statusBadge(block)}</div>
      <div class="price-row">
        <span class="price num ${signClass(block.spread)}">${fmtPct(block.spread, 1).replace("%", " pp")}</span>
        <span class="chg">bika − medve</span>
      </div>
      <div class="stack" aria-hidden="true">
        <span style="width:${block.bull}%"></span>
        <span style="width:${block.neutral}%"></span>
        <span style="width:${block.bear}%"></span>
      </div>
      <div class="stats">
        <span class="up">Bika <b class="num">${fmt(block.bull, 1)}%</b></span>
        <span>Semleges <b class="num">${fmt(block.neutral, 1)}%</b></span>
        <span class="down">Medve <b class="num">${fmt(block.bear, 1)}%</b></span>
      </div>
      <p class="fine">Hosszú átlag: bika ${fmt(avg.bull, 1)}%, semleges ${fmt(avg.neutral, 1)}%, medve ${fmt(avg.bear, 1)}%. Szélsőséges olvasat gyakran ellentétes jelzés.</p>
      ${(block.history || []).length >= 8 ? '<div class="chart-box spark"><canvas id="chart-aaii"></canvas></div>' : ""}
      <p class="source">${formatDay(block.as_of)} · ${block.note || block.source || ""}</p>
    </article>`;
}

function renderPutCall(block) {
  if (!block || block.value === null || block.value === undefined) return unavailable("Put/call arány", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>Put/call</h3>${statusBadge(block)} <span class="badge">${putWord(block.value)}</span></div>
      <div class="price-row"><span class="price num">${fmt(block.value, 2)}</span></div>
      <p class="fine">CBOE részvényopciós put/call, 5 napos átlag. 0,7 alatt kevés a védelem, 1 felett a putok vannak többségben.</p>
      <div class="chart-box spark"><canvas id="chart-pc"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${block.source || ""}</p>
    </article>`;
}

function renderHy(block) {
  if (!block || block.value === null || block.value === undefined) return unavailable("Magas hozamú felár", block);
  return `
    <article class="card">
      <div class="card-kicker"><h3>Magas hozamú felár</h3>${statusBadge(block)} <span class="badge">${hyWord(block.value)}</span></div>
      <div class="price-row"><span class="price num">${fmt(block.value, 2)}%</span></div>
      <p class="fine">Mennyivel fizet többet az amerikai bóvli kötvény az állampapír felett. Táguló felár kockázatkerülést jelent.</p>
      <div class="chart-box spark"><canvas id="chart-hy"></canvas></div>
      <p class="source">${formatDay(block.as_of)} · ${block.source || ""}</p>
    </article>`;
}

function drawSeries(id, history, key, color, digits, suffix) {
  const series = lineData(history, key);
  if (series.values.length < 2) return;
  mountChart(document.getElementById(id), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [{
        label: key,
        data: series.values,
        borderColor: color,
        digits,
        suffix,
      }],
    },
    options: baseOptions({
      plugins: { legend: { display: false }, tooltip: baseOptions().plugins.tooltip },
      scales: { x: { display: false }, y: { display: false } },
    }),
  });
}

function drawSentiment(sentiment) {
  drawSeries("chart-vix", sentiment.vix.history, "value", COLORS.vix, 2, "");
  const term = sentiment.vix_term.history || [];
  if (term.length > 1 && document.getElementById("chart-term")) {
    mountChart(document.getElementById("chart-term"), {
      type: "line",
      data: {
        labels: term.map((row) => row.date),
        datasets: [
          { label: "VIX9D", data: term.map((row) => row.vix9d), borderColor: COLORS.vix9d, digits: 2, spanGaps: true },
          { label: "VIX", data: term.map((row) => row.vix), borderColor: COLORS.vix, digits: 2, spanGaps: true },
          { label: "VIX3M", data: term.map((row) => row.vix3m), borderColor: COLORS.vix3m, digits: 2, spanGaps: true },
        ],
      },
      options: baseOptions({
        plugins: { legend: { display: false }, tooltip: baseOptions().plugins.tooltip },
        scales: { x: { display: false }, y: { display: false } },
      }),
    });
  }
  drawSeries("chart-fg", sentiment.fear_greed.history, "score", COLORS.fg, 1, "");
  const aaii = sentiment.aaii.history || [];
  if (aaii.length > 1 && document.getElementById("chart-aaii")) {
    mountChart(document.getElementById("chart-aaii"), {
      type: "line",
      data: {
        labels: aaii.map((row) => row.date),
        datasets: [
          { label: "Bika", data: aaii.map((row) => row.bull), borderColor: COLORS.bull, digits: 1, suffix: "%" },
          { label: "Medve", data: aaii.map((row) => row.bear), borderColor: COLORS.bear, digits: 1, suffix: "%" },
        ],
      },
      options: baseOptions({
        plugins: { legend: { display: false }, tooltip: baseOptions().plugins.tooltip },
        scales: { x: { display: false }, y: { display: false } },
      }),
    });
  }
  drawSeries("chart-pc", sentiment.put_call.history, "value", COLORS.put, 2, "");
  drawSeries("chart-hy", sentiment.hy_spread.history, "value", COLORS.hy, 2, "%");
}

function lastYear(history) {
  const rows = history || [];
  return rows.slice(-252);
}

function renderQuote(item) {
  if (!item || item.price === null || item.price === undefined) {
    return unavailable(item ? item.name : "Index", item);
  }
  const digits = item.digits ?? 2;
  const unit = item.unit && item.unit !== "index" ? ` ${item.unit}` : "";
  return `
    <article class="card">
      <div class="card-kicker"><h3>${item.name}</h3><span class="badge">${item.ticker}</span></div>
      <div class="price-row">
        <span class="price num">${fmt(item.price, digits)}</span>
        <span class="chg num ${signClass(item.change_pct)}">${fmtPct(item.change_pct)}</span>
      </div>
      <div class="dma">
        <span>50 napos <b class="num ${signClass(item.dist50_pct)}">${fmtPct(item.dist50_pct, 1)}</b></span>
        <span>200 napos <b class="num ${signClass(item.dist200_pct)}">${fmtPct(item.dist200_pct, 1)}</b></span>
      </div>
      <div class="chart-box spark"><canvas id="spark-${item.id}"></canvas></div>
      <p class="source">${formatDay(item.as_of)}${unit ? " · " + unit.trim() : ""} · ${statusBadge(item)} ${item.source || ""}</p>
    </article>`;
}

function renderIndices(indices) {
  return `
    <section>
      <div class="section-head">
        <div>
          <h2>Indexek</h2>
          <p>Záróár, napi változás, és távolság a 50 és 200 napos átlagtól.</p>
        </div>
      </div>
      <article class="card panel">
        <div class="card-kicker"><h3>Egyéves teljesítmény, 100-ra indexelve</h3></div>
        <div class="chart-box mid"><canvas id="chart-compare"></canvas></div>
      </article>
      <div class="grid-quotes" style="margin-top:12px">
        ${indices.map(renderQuote).join("")}
      </div>
    </section>`;
}

function renderExtras(extras) {
  return `
    <section>
      <div class="section-head">
        <div>
          <h2>Dollár, arany, olaj, bitcoin</h2>
          <p>A részvényeken kívüli, gyakran együtt mozgó piacok.</p>
        </div>
      </div>
      <div class="grid-quotes">
        ${extras.map(renderQuote).join("")}
      </div>
    </section>`;
}

function drawSpark(item) {
  const canvas = document.getElementById(`spark-${item.id}`);
  const rows = lastYear(item.history);
  if (!canvas || rows.length < 2) return;
  const up = rows[rows.length - 1].close >= rows[0].close;
  mountChart(canvas, {
    type: "line",
    data: {
      labels: rows.map((row) => row.date),
      datasets: [{
        label: item.name,
        data: rows.map((row) => row.close),
        borderColor: up ? "#3dcf8e" : "#ff6b7d",
        digits: item.digits ?? 2,
      }],
    },
    options: baseOptions({
      plugins: { legend: { display: false }, tooltip: baseOptions().plugins.tooltip },
      scales: { x: { display: false }, y: { display: false } },
    }),
  });
}

function drawCompare(indices) {
  const anchor = indices.find((item) => item.id === "spx" && item.history && item.history.length);
  const canvas = document.getElementById("chart-compare");
  if (!anchor || !canvas) return;
  const dates = lastYear(anchor.history).map((row) => row.date);
  const datasets = indices.filter((item) => item.history && item.history.length).map((item, index) => {
    const map = new Map(item.history.map((row) => [row.date, row.close]));
    const raw = dates.map((day) => map.get(day) ?? null);
    const base = raw.find((value) => value !== null && value !== undefined);
    return {
      label: item.name,
      data: raw.map((value) => (value === null || !base ? null : (value / base) * 100)),
      borderColor: INDEX_COLORS[index % INDEX_COLORS.length],
      spanGaps: true,
      digits: 1,
    };
  });
  mountChart(canvas, {
    type: "line",
    data: { labels: dates, datasets },
    options: baseOptions(),
  });
}

function renderYields(yields) {
  const current = yields.current || {};
  const tiles = [
    ["3 hónap", current.m3],
    ["2 év", current.y2],
    ["10 év", current.y10],
    ["30 év", current.y30],
    ["10 év − 2 év", current.spread],
  ];
  const spreadText = current.spread === null || current.spread === undefined
    ? ""
    : current.spread < 0
      ? "A 10 és 2 éves hozam különbsége negatív: a görbe invertált, amit a piac gyakran lassulásként olvas."
      : "A 10 éves hozam a 2 éves felett van: a görbe normál irányba lejt.";
  return `
    <section>
      <div class="section-head">
        <div>
          <h2>Amerikai kötvényhozamok</h2>
          <p>A hozamgörbe rövid és hosszú vége, százalékpontban.</p>
        </div>
        ${statusBadge(yields)}
      </div>
      <div class="yield-row">
        ${tiles.map(([label, value]) => `
          <article class="card kpi">
            <div class="label">${label}</div>
            <div class="value num ${label.startsWith("10 év −") ? signClass(value) : ""}">${fmt(value, 2)}${value === null || value === undefined ? "" : "%"}</div>
          </article>`).join("")}
      </div>
      <p class="story">${spreadText}</p>
      <div class="yield-charts">
        <article class="card">
          <h3>Hozamok</h3>
          <div class="chart-box mid"><canvas id="chart-yields"></canvas></div>
        </article>
        <article class="card">
          <h3>10 év − 2 év</h3>
          <div class="chart-box mid"><canvas id="chart-spread"></canvas></div>
        </article>
      </div>
      <p class="source">${formatDay(yields.as_of)} · ${yields.source || ""}</p>
    </section>`;
}

function drawYields(yields) {
  const history = yields.history || [];
  if (history.length < 2) return;
  const labels = history.map((row) => row.date);
  mountChart(document.getElementById("chart-yields"), {
    type: "line",
    data: {
      labels,
      datasets: [
        ["m3", "3 hónap", COLORS.m3],
        ["y2", "2 év", COLORS.y2],
        ["y10", "10 év", COLORS.y10],
        ["y30", "30 év", COLORS.y30],
      ].map(([key, label, color]) => ({
        label,
        data: history.map((row) => row[key]),
        borderColor: color,
        spanGaps: true,
        digits: 2,
        suffix: "%",
      })),
    },
    options: baseOptions(),
  });
  mountChart(document.getElementById("chart-spread"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "10 év − 2 év",
          data: history.map((row) => row.spread),
          borderColor: COLORS.spread,
          spanGaps: true,
          digits: 2,
          suffix: " pp",
        },
        {
          label: "nulla",
          data: history.map(() => 0),
          borderColor: "rgba(232,238,246,0.35)",
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
            boxWidth: 10,
            boxHeight: 10,
            color: "#8ea0b5",
            filter: (item) => item.text !== "nulla",
          },
        },
      },
    }),
  });
}

function problems(data) {
  const blocks = [
    ["Kereskedési pontszám", data.trading_score],
    ["Nasdaq trendszűrő", data.nasdaq_trend],
    ["Szélesség", data.breadth],
    ["VIX", data.sentiment.vix],
    ["VIX lejárat", data.sentiment.vix_term],
    ["Fear & Greed", data.sentiment.fear_greed],
    ["AAII", data.sentiment.aaii],
    ["Put/call", data.sentiment.put_call],
    ["Hitelkockázati felár", data.sentiment.hy_spread],
    ["Hozamok", data.yields],
    ...data.indices.map((item) => [item.name, item]),
    ...data.extras.map((item) => [item.name, item]),
  ];
  return blocks.filter(([, block]) => block && block.status && block.status !== "ok");
}

function render(data) {
  const issues = problems(data);
  const banner = issues.length
    ? `<div class="alert">Nem minden forrás frissült (${issues.map(([name, block]) => `${name}: ${block.status === "stale" ? "utolsó ismert adat" : "nem elérhető"}`).join(", ")}). Ahol van korábbi jó érték, azt mutatjuk a dátumával.</div>`
    : "";
  document.getElementById("app").innerHTML = `
    ${renderTradingScore(data.trading_score)}
    ${renderNasdaqTrend(data.nasdaq_trend)}
    ${renderBreadth(data.breadth)}
    ${banner}
    ${renderSentiment(data.sentiment)}
    ${renderIndices(data.indices)}
    ${renderYields(data.yields)}
    ${renderExtras(data.extras)}
  `;
  drawSentiment(data.sentiment);
  data.indices.forEach(drawSpark);
  data.extras.forEach(drawSpark);
  drawCompare(data.indices);
  drawYields(data.yields);
}

function renderHeader(meta) {
  const box = document.getElementById("updated");
  box.innerHTML = `
    <p class="eyebrow">Utolsó frissítés · ${meta.timezone || "Europe/Budapest"}</p>
    <p class="stamp">${meta.generated_at_budapest || "–"} <span>· piaci nap ${formatDay(meta.market_date)}</span></p>`;
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
    app.innerHTML = `<p class="error-banner">Az adatfájl nem olvasható. Futtasd a <span class="num">python scripts/fetch_data.py</span> parancsot, majd frissítsd az oldalt. (${error.message})</p>`;
  }
}

main();
