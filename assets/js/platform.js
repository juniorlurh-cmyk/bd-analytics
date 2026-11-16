/* ============================================================
   Civix Analytics — platform frontend
   Dashboard (ECharts + Leaflet) + verified-answer chat.
   Live mode: CIVIX backend via config.js apiBase.
   Demo mode: bundled data/snapshot.json + local answer composer.
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.BD_CONFIG || {};
  var API = (CFG.apiBase || "").replace(/\/$/, "");

  var PROV_NAMES = {
    1: "Western Cape", 2: "Eastern Cape", 3: "Northern Cape", 4: "Free State",
    5: "KwaZulu-Natal", 6: "North West", 7: "Gauteng", 8: "Mpumalanga", 9: "Limpopo",
  };
  var GEOTYPE_NAMES = { 1: "Urban", 2: "Traditional", 3: "Farms" };
  // approximate province centroids for the bubble map [lat, lng]
  var PROV_CENTROIDS = {
    1: [-33.0, 19.2], 2: [-32.2, 26.6], 3: [-29.2, 21.8], 4: [-28.6, 26.3],
    5: [-29.1, 30.2], 6: [-26.6, 25.6], 7: [-26.3, 28.4], 8: [-26.6, 30.4],
    9: [-23.9, 29.9],
  };

  var KPI_IDS = [
    "energy.grid_connection",
    "people.unemployment_rate",
    "foodsecurity.hungry",
    "water.piped_access",
  ];

  var state = {
    snapshot: null,
    mode: "demo",
    indicator: "energy.grid_connection",
    breakdown: "prov",
    chart: null,
    map: null,
    markers: [],
  };

  /* ---------------- helpers ---------------- */

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function indById(id) {
    return state.snapshot.indicators.find(function (i) { return i.id === id; });
  }
  function natValue(id) {
    var v = state.snapshot.values[id] && state.snapshot.values[id].national;
    if (!v || !v.rows.length) return null;
    return v.rows[0];
  }
  function fmtValue(ind, row) {
    if (!row || row.value == null) return "—";
    if (ind.unit === "percent") return (row.value_pct != null ? row.value_pct : row.value * 100).toFixed(1) + "%";
    if (ind.unit === "rand") return "R " + Math.round(row.value).toLocaleString("en-ZA");
    if (ind.unit === "ratio") return row.value.toFixed(2);
    return (Math.round(row.value * 10) / 10).toLocaleString("en-ZA");
  }
  function fmtUnit(ind) {
    return { percent: "", rand: "ZAR", persons: "persons", years: "yrs", count: "", ratio: "" }[ind.unit] || "";
  }
  function groupRows(id, breakdown) {
    var v = state.snapshot.values[id] && state.snapshot.values[id][breakdown];
    return (v && v.rows) || [];
  }

  /* ---------------- mode detection ---------------- */

  function setMode(mode) {
    state.mode = mode;
    var b = $("#mode-badge");
    b.textContent = mode === "live" ? "● LIVE API" : "DEMO MODE";
    b.className = "mode-badge " + (mode === "live" ? "mode-live" : "mode-demo");
  }

  function probeApi() {
    if (!API) return Promise.resolve(false);
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 4000);
    return fetch(API + "/api/v1/health", { signal: ctrl.signal })
      .then(function (r) { clearTimeout(t); return r.ok; })
      .catch(function () { clearTimeout(t); return false; });
  }

  /* ---------------- KPIs ---------------- */

  function renderKpis() {
    var host = $("#kpi-row");
    host.innerHTML = "";
    KPI_IDS.forEach(function (id) {
      var ind = indById(id);
      var row = natValue(id);
      if (!ind || !row) return;
      var prov = groupRows(id, "prov").filter(function (r) { return r.value != null; });
      var hi = prov.slice().sort(function (a, b) { return b.value - a.value; })[0];
      var kpi = document.createElement("div");
      kpi.className = "kpi" + (id === state.indicator ? " active" : "");
      kpi.dataset.id = id;
      kpi.innerHTML =
        '<div class="kpi-label">' + esc(ind.name) + '</div>' +
        '<div class="kpi-value">' + fmtValue(ind, row) + '</div>' +
        '<div class="kpi-delta">' + esc(hi ? hi.grp_label : "") + " highest: " + (hi ? fmtValue(ind, hi) : "—") + "</div>";
      kpi.addEventListener("click", function () {
        selectIndicator(id);
        setBreakdown("prov");
      });
      host.appendChild(kpi);
    });
  }

  /* ---------------- indicator select ---------------- */

  function renderIndicatorSelect() {
    var sel = $("#indicator-select");
    sel.innerHTML = "";
    var domains = {};
    state.snapshot.indicators.forEach(function (ind) {
      (domains[ind.domain] = domains[ind.domain] || []).push(ind);
    });
    Object.keys(domains).sort().forEach(function (d) {
      var og = document.createElement("optgroup");
      og.label = d.replace(/_/g, " ");
      domains[d].forEach(function (ind) {
        var o = document.createElement("option");
        o.value = ind.id;
        o.textContent = ind.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.value = state.indicator;
    sel.onchange = function () { selectIndicator(sel.value); };
  }

  function selectIndicator(id) {
    state.indicator = id;
    $("#indicator-select").value = id;
    $$(".kpi").forEach(function (k) { k.classList.toggle("active", k.dataset.id === id); });
    $$("#matrix-table tbody tr").forEach(function (tr) {
      tr.classList.toggle("selected", tr.dataset.id === id);
    });
    renderChart();
    renderMap();
    renderMatrixSelection();
  }

  /* ---------------- breakdown ---------------- */

  function setBreakdown(b) {
    state.breakdown = b;
    $$("#breakdown-seg button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.b === b);
    });
    renderChart();
  }

  /* ---------------- main chart ---------------- */

  function chartTheme() {
    return {
      backgroundColor: "transparent",
      textStyle: { color: "#93a1b8", fontFamily: "Inter, sans-serif" },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#182133", borderColor: "#22304a", textStyle: { color: "#e6edf7", fontSize: 12 },
        formatter: function (ps) {
          var p = ps[0];
          return "<b>" + esc(p.name) + "</b><br/>" + esc(p.seriesName) + ": " + esc(p.value[1]);
        },
      },
    };
  }

  function renderChart() {
    var ind = indById(state.indicator);
    if (!ind) return;
    var rows;
    var title;
    if (state.breakdown === "national") {
      // peers in same domain, national values
      rows = state.snapshot.indicators
        .filter(function (i) { return i.domain === ind.domain && i.unit === ind.unit; })
        .map(function (i) { var r = natValue(i.id); return r ? { name: i.name, v: r.value, ind: i } : null; })
        .filter(Boolean)
        .sort(function (a, b) { return a.v - b.v; });
      title = ind.domain.replace(/_/g, " ") + " — national comparison";
    } else {
      rows = groupRows(state.indicator, state.breakdown)
        .filter(function (r) { return r.value != null; })
        .map(function (r) {
          return { name: r.grp_label || String(r.grp), v: r.value, pct: r.value_pct };
        })
        .sort(function (a, b) { return a.v - b.v; });
      title = ind.name + " — by " + (state.breakdown === "prov" ? "province" : "geography type");
    }

    $("#chart-title").textContent = title;
    $("#chart-tag").textContent = ind.unit === "percent" ? "weighted %" : ind.unit;

    var isPct = ind.unit === "percent";
    var data = rows.map(function (r) {
      var label = isPct ? (r.pct != null ? r.pct.toFixed(1) + "%" : (r.v * 100).toFixed(1) + "%") : fmtValue(ind, r);
      return { name: r.name, value: [label, r.v] };
    });
    var names = rows.map(function (r) { return r.name; });

    var option = {
      grid: { left: 8, right: 70, top: 10, bottom: 24, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { formatter: isPct ? function (v) { return v + "%"; } : undefined },
        splitLine: { lineStyle: { color: "#1a2536" } },
      },
      yAxis: {
        type: "category", data: names, inverse: true,
        axisLabel: { color: "#93a1b8", fontSize: 11.5, width: 130, overflow: "truncate" },
        axisLine: { lineStyle: { color: "#22304a" } },
      },
      series: [{
        type: "bar", data: data, barMaxWidth: 22,
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#0e7490" }, { offset: 1, color: "#22d3ee" },
          ]),
        },
        label: { show: true, position: "right", color: "#93a1b8", fontSize: 11, fontFamily: "JetBrains Mono, monospace" },
        emphasis: { itemStyle: { color: "#818cf8" } },
      }],
      animationDuration: 500,
    };

    var el = $("#main-chart");
    if (!state.chart) state.chart = echarts.init(el);
    state.chart.setOption(option, true);
  }

  /* ---------------- province map ---------------- */

  function renderMap() {
    var ind = indById(state.indicator);
    if (!ind) return;
    var rows = groupRows(state.indicator, "prov").filter(function (r) { return r.value != null; });
    if (!rows.length) return;
    var vals = rows.map(function (r) { return r.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;

    if (!state.map) {
      state.map = L.map("map", { zoomControl: true, attributionControl: false }).setView([-29.5, 24.5], 5);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 10,
      }).addTo(state.map);
    }
    state.markers.forEach(function (m) { state.map.removeLayer(m); });
    state.markers = [];

    rows.forEach(function (r) {
      var c = PROV_CENTROIDS[r.grp];
      if (!c) return;
      var t = (r.value - min) / span;
      var radius = 10 + t * 26;
      var color = "hsl(" + Math.round(190 - t * 160) + ", 90%, " + Math.round(45 + t * 15) + "%)";
      var marker = L.circleMarker(c, {
        radius: radius, color: "#fff", weight: 1.5,
        fillColor: color, fillOpacity: 0.75, className: "prov-marker",
      });
      var label = fmtValue(ind, r);
      marker.bindPopup(
        "<b>" + esc(r.grp_label) + "</b><br/>" + esc(ind.name) + ": <b>" + esc(label) + "</b>"
      );
      marker.addTo(state.map);
      state.markers.push(marker);
    });
  }

  /* ---------------- matrix table ---------------- */

  function renderMatrix() {
    var tb = $("#matrix-table tbody");
    tb.innerHTML = "";
    var provBreakdownOk = state.snapshot.indicators.every(function (i) {
      return state.snapshot.values[i.id] && state.snapshot.values[i.id].prov;
    });
    state.snapshot.indicators.forEach(function (ind) {
      var nat = natValue(ind.id);
      var tr = document.createElement("tr");
      tr.dataset.id = ind.id;
      var provRows = groupRows(ind.id, "prov").filter(function (r) { return r.value != null; });
      var hi = provRows.slice().sort(function (a, b) { return b.value - a.value; })[0];
      var lo = provRows.slice().sort(function (a, b) { return a.value - b.value; })[0];
      tr.innerHTML =
        "<td>" + esc(ind.name) + "</td>" +
        "<td><span class='domain-tag'>" + esc((ind.domain || "").replace(/_/g, " ")) + "</span></td>" +
        "<td class='num'>" + (nat ? fmtValue(ind, nat) : "—") + "</td>" +
        "<td class='num'>" + (hi ? esc(hi.grp_label) + " · " + fmtValue(ind, hi) : "—") + "</td>" +
        "<td class='num'>" + (lo ? esc(lo.grp_label) + " · " + fmtValue(ind, lo) : "—") + "</td>";
      tr.addEventListener("click", function () {
        selectIndicator(ind.id);
        setBreakdown("prov");
        document.querySelector(".dash").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      tb.appendChild(tr);
    });
    $("#matrix-tag").textContent = state.snapshot.indicators.length + " indicators";
    renderMatrixSelection();
  }

  function renderMatrixSelection() {
    $$("#matrix-table tbody tr").forEach(function (tr) {
      tr.classList.toggle("selected", tr.dataset.id === state.indicator);
    });
  }

  /* ---------------- chat ---------------- */

  function addMsg(role, html, meta) {
    var log = $("#chat-log");
    var div = document.createElement("div");
    div.className = "msg msg-" + role;
    div.innerHTML =
      '<div class="msg-avatar">' + (role === "user" ? "You" : "Cx") + "</div>" +
      '<div class="msg-body">' + html + (meta ? '<div class="msg-meta">' + esc(meta) + "</div>" : "") + "</div>";
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function typingBubble() {
    var log = $("#chat-log");
    var div = document.createElement("div");
    div.className = "msg msg-bot msg-typing";
    div.innerHTML = '<div class="msg-avatar">Cx</div><div class="msg-body typing-dots">analysing…</div>';
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function renderAnswer(text, citations, meta) {
    var html = renderMarkdown(text);
    if (citations && citations.length) {
      html += '<div class="msg-cites">' + citations.map(function (c) {
        return '<span class="cite-chip" title="' + esc(c.source || c.id || "") + '">' + esc(c.key || "src") + "</span>";
      }).join("") + "</div>";
    }
    addMsg("bot", html, meta);
  }

  function renderMarkdown(text) {
    var escd = esc(text);
    // bold **x**
    escd = escd.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // inline code `x`
    escd = escd.replace(/`([^`]+)`/g, "<code>$1</code>");
    // [Cn] citation markers -> chips
    escd = escd.replace(/\[C(\d+)\]/g, '<span class="cite-chip">C$1</span>');
    // simple lists
    escd = escd.replace(/(^|\n)- /g, "$1• ");
    return escd.split(/\n{2,}/).map(function (p) { return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; }).join("");
  }

  /* ---------- demo-mode answer composer ---------- */

  var STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are", "was", "what", "which", "how", "many", "much", "does", "do", "with", "by", "at", "it", "its", "between", "vs", "versus", "me", "show", "tell", "about", "from", "that", "this", "there", "their", "have", "has", "had", "be", "been", "being", "can", "could", "would", "should", "sa", "south", "africa", "african", "rate", "share", "percent"]);

  function tokenize(q) {
    return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter(function (t) { return t.length > 2 && !STOP.has(t); });
  }

  function scoreIndicator(ind, terms) {
    var hay = (ind.id + " " + ind.name + " " + ind.domain + " " + (ind.description || "")).toLowerCase();
    var score = 0;
    terms.forEach(function (t) {
      if (hay.indexOf(t) !== -1) score += t.length > 5 ? 2 : 1;
    });
    // phrase boost
    terms.forEach(function (t) {
      if (ind.id.indexOf(t) !== -1) score += 3;
    });
    return score;
  }

  function detectGeography(q) {
    var lq = q.toLowerCase();
    for (var code in PROV_NAMES) {
      if (lq.indexOf(PROV_NAMES[code].toLowerCase()) !== -1) return { type: "prov", code: parseInt(code, 10) };
    }
    if (/urban|city|formal/.test(lq) && !/traditional|rural|farm/.test(lq)) return { type: "geotype", code: 1 };
    if (/traditional|rural/.test(lq)) return { type: "geotype", code: 2 };
    if (/farm/.test(lq)) return { type: "geotype", code: 3 };
    return null;
  }

  function demoAnswer(question) {
    var terms = tokenize(question);
    var scored = state.snapshot.indicators.map(function (ind) {
      return { ind: ind, score: scoreIndicator(ind, terms) };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) {
      return {
        text: "I couldn't match that to a specific GHS 2024 indicator. I can answer questions about water, sanitation, energy, food security, income, labour, education, health, housing and welfare — for example **\"What is the unemployment rate by province?\"** or **\"How many households have piped water?\"**",
        citations: [],
      };
    }

    var picks = scored.slice(0, 3);
    var geo = detectGeography(question);
    var lines = [];
    var cites = [];
    var cn = 0;

    picks.forEach(function (p, idx) {
      var ind = p.ind;
      cn++;
      cites.push({ key: "C" + cn, id: ind.id, source: "GHS 2024 · " + ind.name });
      var nat = natValue(ind.id);
      var parts = [];
      if (nat) parts.push("nationally, **" + fmtValue(ind, nat) + "**");

      // breakdown sentence
      var rows = geo
        ? groupRows(ind.id, geo.type).filter(function (r) { return r.grp === geo.code; })
        : groupRows(ind.id, "prov").filter(function (r) { return r.value != null; });

      if (geo && rows.length) {
        cn++;
        cites.push({ key: "C" + cn, id: ind.id, source: "GHS 2024 · " + ind.name + " (" + geo.type + "=" + geo.code + ")" });
        var r = rows[0];
        parts.push("in **" + (r.grp_label || PROV_NAMES[r.grp] || GEOTYPE_NAMES[r.grp] || r.grp) + "** it is **" + fmtValue(ind, r) + "**");
      } else if (!geo && ind.unit === "percent") {
        var provRows = groupRows(ind.id, "prov").filter(function (r) { return r.value != null; });
        if (provRows.length > 1) {
          var hi = provRows.slice().sort(function (a, b) { return b.value - a.value; })[0];
          var lo = provRows.slice().sort(function (a, b) { return a.value - b.value; })[0];
          cn++;
          cites.push({ key: "C" + cn, id: ind.id, source: "GHS 2024 · " + ind.name + " by province" });
          parts.push("**" + hi.grp_label + "** reports the highest (" + fmtValue(ind, hi) + ") and **" + lo.grp_label + "** the lowest (" + fmtValue(ind, lo) + ")");
        }
      }

      var prefix = idx === 0 ? "**" + ind.name + "** — " : "Related: **" + ind.name + "** — ";
      lines.push(prefix + (parts.join("; ") || "no national estimate available") + " [C" + (idx + 1) + "]");
      if (ind.caveat) lines.push("- _Caveat: " + ind.caveat + "_");
    });

    lines.push("\n_All figures are survey-weighted estimates from the General Household Survey 2024 (" + state.snapshot.period + "), computed by the Civix analytics engine. Descriptive statistics only — not causal claims._");

    return { text: lines.join("\n\n"), citations: cites };
  }

  /* ---------- live-mode ask ---------- */

  function liveAnswer(question) {
    return fetch(API + "/api/v1/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question }),
    }).then(function (r) {
      if (!r.ok) throw new Error("API " + r.status);
      return r.json();
    }).then(function (data) {
      var cites = (data.citations || []).map(function (c) {
        return { key: c.key, id: c.id, source: c.source || c.name || c.type };
      });
      var verified = data.verification && data.verification.final_deterministic;
      var meta = (verified && verified.passed ? "verified answer · " : "answer (verification flagged) · ") + data.model;
      return { text: data.answer, citations: cites, meta: meta };
    });
  }

  function ask(question) {
    question = question.trim();
    if (!question) return;
    addMsg("user", "<p>" + esc(question) + "</p>");
    var typing = typingBubble();
    $("#chat-send").disabled = true;

    var promise;
    if (state.mode === "live") {
      promise = liveAnswer(question).catch(function () {
        return demoAnswer(question); // graceful fallback
      });
    } else {
      promise = Promise.resolve(demoAnswer(question));
    }

    promise.then(function (res) {
      typing.remove();
      renderAnswer(res.text, res.citations, res.meta || "demo answer · computed from bundled GHS 2024 snapshot");
    }).catch(function (e) {
      typing.remove();
      renderAnswer("Sorry — I couldn't process that request (" + esc(e.message) + "). Try rephrasing, or check that the Civix API is reachable.", [], "error");
    }).finally(function () {
      $("#chat-send").disabled = false;
      $("#chat-text").focus();
    });
  }

  /* ---------------- wiring ---------------- */

  function init() {
    fetch("data/snapshot.json").then(function (r) {
      if (!r.ok) throw new Error("snapshot missing");
      return r.json();
    }).then(function (snap) {
      state.snapshot = snap;
      $("#dash-sub").textContent = snap.survey + " · " + snap.period + " · survey-weighted";
      renderIndicatorSelect();
      renderKpis();
      renderChart();
      renderMap();
      renderMatrix();
      selectIndicator(state.indicator);
    }).catch(function (e) {
      $("#kpi-row").innerHTML = "<p style='color:var(--danger);padding:20px;'>Failed to load snapshot data: " + esc(e.message) + "</p>";
    });

    $$("#breakdown-seg button").forEach(function (btn) {
      btn.addEventListener("click", function () { setBreakdown(btn.dataset.b); });
    });

    $$("#chips .chip").forEach(function (c) {
      c.addEventListener("click", function () { ask(c.dataset.q); });
    });

    $("#chat-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = $("#chat-text");
      ask(inp.value);
      inp.value = "";
    });

    window.addEventListener("resize", function () {
      if (state.chart) state.chart.resize();
    });

    // probe live API last — demo renders immediately regardless
    probeApi().then(function (ok) { setMode(ok ? "live" : "demo"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
