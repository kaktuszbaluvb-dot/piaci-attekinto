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

function renderBreadth(breadth) {
  const current = breadth.current || {};
  const tiles = [
    ["spx200", "S&P 500 · 200 napos", current.spx200, COLORS.spx200],
    ["spx50", "S&P 500 · 50 napos", current.spx50, COLORS.spx50],
    ["ndx200", "Nasdaq-100 · 200 napos", current.ndx200, COLORS.ndx200],
    ["ndx50", "Nasdaq-100 · 50 napos", current.ndx50, COLORS.ndx50],
  ];
  const sample = `S&P minta: ${current.spx_n ?? "–"} / ${breadth.universe ? breadth.universe.spx : "–"} · Nasdaq-100 minta: ${current.ndx_n ?? "–"} / ${breadth.universe ? breadth.universe.ndx : "–"}`;
  return `
    <section>
      <div class="section-head">
        <div>
          <h2>Piaci szélesség</h2>
          <p>A részvények hány százaléka forog a saját mozgóátlaga felett.</p>
        </div>
        ${statusBadge(breadth)}
      </div>
      <div class="grid-4">
        ${tiles.map(([, label, value, color]) => `
          <article class="card kpi">
            <div class="label"><span>${label}</span><i class="dot" style="background:${color}"></i></div>
            <div class="value num">${value === null || value === undefined ? "–" : fmt(value, 1) + "%"}</div>
            <p class="hint">${breadthWord(value)}</p>
          </article>`).join("")}
      </div>
      <p class="story">${breadthStory(current.spx200)}</p>
      <article class="card panel">
        <div class="chart-box"><canvas id="chart-breadth"></canvas></div>
        <p class="source">${sample} · Zárónap: ${formatDay(breadth.as_of)} · ${breadth.source || ""}</p>
      </article>
    </section>`;
}

function drawBreadth(breadth) {
  const history = breadth.history || [];
  const sets = [
    ["spx200", "S&P 500, 200 napos", COLORS.spx200],
    ["spx50", "S&P 500, 50 napos", COLORS.spx50],
    ["ndx200", "Nasdaq-100, 200 napos", COLORS.ndx200],
    ["ndx50", "Nasdaq-100, 50 napos", COLORS.ndx50],
  ];
  mountChart(document.getElementById("chart-breadth"), {
    type: "line",
    data: {
      labels: history.map((row) => row.date),
      datasets: sets.map(([key, label, color]) => ({
        label,
        data: history.map((row) => row[key]),
        borderColor: color,
        spanGaps: true,
        digits: 1,
        suffix: "%",
      })),
    },
    options: baseOptions(),
  });
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
    ${banner}
    ${renderBreadth(data.breadth)}
    ${renderSentiment(data.sentiment)}
    ${renderIndices(data.indices)}
    ${renderYields(data.yields)}
    ${renderExtras(data.extras)}
  `;
  drawBreadth(data.breadth);
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
