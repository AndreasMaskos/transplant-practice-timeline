// app.js -- draws the practice-change timelines from window.TIMELINE (data.js, written by
// build_practice_timeline.R). One chart per selected view, stacked on one shared time axis.
// The selection lives in the URL hash (index.html#pediatric-heart+pediatric-lung), so every
// combination has its own link; a page's <body data-default="..."> is its starting view.
(function () {
  const D = window.TIMELINE;
  // The selectable views as the data file lists them, in drawing order: hearts before lungs,
  // and within an organ pediatric before adult, so panels of one organ sit under each other.
  const VIEWS = D.views.slice().sort((a, b) => a.split("-")[1].localeCompare(b.split("-")[1]) || b.localeCompare(a));
  // Verification status: key in the data, display name, color (validated), plotly symbol,
  // and the same shape as a small SVG for the toggle button.
  const STATUS = [
    { k: "verified", label: "Verified", color: "#1f77b4", symbol: "circle", svg: "<circle cx='7' cy='7' r='5'/>" },
    { k: "partly verified", label: "Partly verified", color: "#b8860b", symbol: "diamond", svg: "<path d='M7 1 L13 7 L7 13 L1 7 Z'/>" },
    { k: "unverified", label: "Unverified", color: "#c0392b", symbol: "x", svg: "<path d='M2 2 L12 12 M12 2 L2 12' stroke-width='3' fill='none'/>" }];
  const FONT = "Arial, Helvetica, sans-serif";
  const X_RANGE = ["1986-01-01", "2027-06-30"];   // the OPTN era, with room for the 2026 entries
  const LEFT = 270;                                // fixed left margin in px, so stacked panels share one time axis
  let selected = [];                               // view keys currently shown
  let shownStatus = new Set(STATUS.map(s => s.k)); // status keys currently shown
  // Importance tiers (pediatric entries are ranked; an unranked entry has no t and is always
  // shown): tier number, button label, marker size in px (larger = more important).
  const TIERS = [{ t: 1, label: "Tier 1", size: 13 }, { t: 2, label: "Tier 2", size: 10 }, { t: 3, label: "Tier 3", size: 7 }];
  const UNRANKED_SIZE = 11;
  let shownTier = new Set(TIERS.map(x => x.t));    // tiers currently shown
  let query = [];                                  // lower-case search words; an entry must contain all of them
  // The searchable text of each entry: date, domain, change, who it applies to, sources and status (tags stripped).
  const TEXT = D.entries.map(e => [e.date, e.lane, e.what, e.applies, e.src, e.status].join(" ").replace(/<[^>]+>/g, " ").toLowerCase());
  // visible(): does an entry or point (both carry id, s and t) pass the status, tier and search filters?
  const visible = o => shownStatus.has(o.s) && (o.t == null || shownTier.has(o.t)) && query.every(w => TEXT[o.id].includes(w));
  let syncing = false;                             // true while one panel's zoom is copied to the others

  const $ = id => document.getElementById(id);
  // wrap(): a label broken into lines of at most n characters, joined by <br> (plotly text).
  const wrap = (s, n) => s.split(" ").reduce((a, w) => {
    if ((a[a.length - 1] + " " + w).trim().length > n) a.push(w); else a[a.length - 1] = (a[a.length - 1] + " " + w).trim();
    return a; }, [""]).join("<br>");

  // The selection: from the hash, else the page's default. "#none" is an explicitly empty view.
  function readSelection() {
    const h = decodeURIComponent(location.hash.slice(1));
    const src = h ? h : (document.body.dataset.default || "");
    return VIEWS.filter(v => src.split("+").includes(v));
  }
  // panelKeys(): the selected views plus, for each population on screen, its "both organs"
  // panel (where the file has one) and its registry panel.
  function panelKeys() {
    const pops = Array.from(new Set(selected.map(v => v.split("-")[0])));
    return selected.concat(pops.flatMap(p => [p + "-both", p + "-registry"]).filter(k => k in D.panels));
  }

  function drawButtons() {
    $("views").innerHTML = VIEWS.map(v =>
      `<button class="tog" data-view="${v}" aria-pressed="${selected.includes(v)}">${D.panels[v].title} <span class="n">${D.panels[v].n}</span></button>`).join(" ");
    const shown = D.entries.filter(e => panelKeys().includes(e.key));
    $("status").innerHTML = STATUS.map(s =>
      `<button class="tog" data-status="${s.k}" aria-pressed="${shownStatus.has(s.k)}"><svg width="14" height="14" fill="${s.color}" stroke="${s.color}">${s.svg}</svg>${s.label} <span class="n">${shown.filter(e => e.s === s.k).length}</span></button>`).join(" ");
    $("tier").innerHTML = TIERS.map(x =>
      `<button class="tog" data-tier="${x.t}" aria-pressed="${shownTier.has(x.t)}"><svg width="14" height="14" fill="#52514e"><circle cx="7" cy="7" r="${x.size / 2}"/></svg>${x.label} <span class="n">${shown.filter(e => e.t === x.t).length}</span></button>`).join(" ");
    $("tiernote").textContent = "Tier 1: who gets transplanted and how donor and recipient are matched. Tier 2: how rejection and graft loss are prevented, detected or treated. Tier 3: context. A larger marker is a higher tier.";
    $("qcount").textContent = query.length ? shown.filter(visible).length + " of " + shown.length + " entries match" : "";
    $("pagelinks").innerHTML = VIEWS.map(v => `<a href="${v}.html">${D.panels[v].title}</a>`).join(" · ");
  }

  // drawPanel(): one chart. Ranges are lines, dated entries markers; customdata is the entry id.
  function drawPanel(key, host) {
    const P = D.panels[key];
    const sec = document.createElement("section");
    const pts = P.points.filter(visible), top = D.top[key];
    sec.innerHTML = `<h2>${P.title}</h2><p class="count">${P.n} entries, ${P.dated} with a date on the axis</p>` +
      (top ? `<details><summary>The ${top.length} most important changes, ranked</summary><table><tr><th>Rank</th><th>Date</th><th>What changed</th><th>Source</th><th>Status</th></tr>` +
        top.map(r => `<tr><td>${r.rank}</td><td>${r.date}</td><td>${r.what}</td><td>${r.src}</td><td>${r.status}</td></tr>`).join("") + "</table></details>" : "") +
      `<div class="chartwrap"><div class="chart"></div></div>`;
    host.appendChild(sec);
    const div = sec.querySelector(".chart"), traces = [];
    STATUS.forEach(s => {
      const d = pts.filter(p => p.s === s.k), r = d.filter(p => p.xend);
      if (r.length) traces.push({ type: "scatter", mode: "lines", hoverinfo: "skip", showlegend: false,
        x: r.flatMap(p => [p.x, p.xend, null]), y: r.flatMap(p => [p.y, p.y, null]), line: { width: 2, color: s.color } });
      traces.push({ type: "scatter", mode: "markers", showlegend: false, x: d.map(p => p.x), y: d.map(p => p.y),
        customdata: d.map(p => p.id), hoverinfo: "text",
        text: d.map(p => { const e = D.entries[p.id]; return `<b>${e.date}</b><br>${wrap(e.what, 70)}<br><i>click for sources</i>`; }),
        marker: { size: d.map(p => p.t == null ? UNRANKED_SIZE : TIERS[p.t - 1].size), color: s.color, symbol: s.symbol, line: { width: 1.5, color: "#ffffff" } } });
    });
    const shapes = P.lanes.slice(1).map(l => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: l.top, y1: l.top, line: { color: "#e1e0d9", width: 1 } }))
      .concat(P.cuts.map(c => ({ type: "line", x0: c.x, x1: c.x, yref: "paper", y0: 0, y1: 1, line: { color: "#8a8a86", width: 1, dash: "dash" } })));
    const notes = P.cuts.map((c, i) => ({ x: c.x, yref: "paper", y: 1, yanchor: "bottom", yshift: i % 2 ? 16 : 2, text: c.label,
      showarrow: false, font: { size: 11, color: "#52514e" } }));
    Plotly.newPlot(div, traces, {
      height: 96 + 21 * P.slots, font: { family: FONT, size: 12, color: "#0b0b0b" },
      xaxis: { range: X_RANGE.slice(), dtick: "M24", tickformat: "%Y", gridcolor: "#eeeeea", zeroline: false },
      yaxis: { tickvals: P.lanes.map(l => l.mid), ticktext: P.lanes.map(l => wrap(l.label, 36)), showgrid: false, zeroline: false,
        range: [-P.slots, 0], fixedrange: true },
      shapes: shapes, annotations: notes, hovermode: "closest", hoverlabel: { bgcolor: "#ffffff", bordercolor: "#c3c2b7", font: { color: "#0b0b0b", family: FONT } },
      margin: { l: LEFT, r: 20, t: 44, b: 30 }, plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff"
    }, { displaylogo: false, responsive: true });
    div.on("plotly_click", ev => showDetail(ev.points[0].customdata));
    // A zoom or pan on one panel is copied to the others, so the time axes stay aligned.
    div.on("plotly_relayout", ev => {
      if (syncing) return;
      const upd = "xaxis.autorange" in ev ? { "xaxis.range": X_RANGE.slice() }
        : ("xaxis.range[0]" in ev ? { "xaxis.range": [ev["xaxis.range[0]"], ev["xaxis.range[1]"]] }
        : ("xaxis.range" in ev ? { "xaxis.range": ev["xaxis.range"].slice() } : null));
      if (!upd) return;
      syncing = true;
      Promise.all(Array.from(document.querySelectorAll(".chart")).filter(o => o !== div || "xaxis.autorange" in ev)
        .map(o => Plotly.relayout(o, upd))).then(() => { syncing = false; });
    });
  }

  // showDetail(): the entry behind a clicked point, with its linked sources (src is HTML
  // escaped and linked by the R script).
  function showDetail(id) {
    const e = D.entries[id];
    $("detail").innerHTML = `<b>${e.date}</b> &nbsp; ${D.panels[e.key].title}: ${e.lane}<br>${e.what}<br>` +
      `<span class="m">Applies to:</span> ${e.applies}<br><span class="m">Sources:</span> ${e.src}<br><span class="m">Status:</span> ${e.status}` +
      (e.t == null ? "" : ` &nbsp; <span class="m">Importance:</span> Tier ${e.t}`);
  }

  function drawTable(keys) {
    const rows = D.entries.filter(e => keys.includes(e.key) && visible(e)).sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key) || a.id - b.id);
    $("table").innerHTML = "<table><tr><th>View</th><th>Domain</th><th>Date</th><th>What changed</th><th>Applies to</th><th>Source</th><th>Status</th><th>Tier</th></tr>" +
      rows.map(e => `<tr><td>${D.panels[e.key].title}</td><td>${e.lane}</td><td>${e.date}</td><td>${e.what}</td><td>${e.applies}</td><td>${e.src}</td><td>${e.status}</td><td>${e.t == null ? "" : e.t}</td></tr>`).join("") + "</table>";
  }

  function render() {
    selected = readSelection();
    const keys = panelKeys(), host = $("charts");
    document.querySelectorAll(".chart").forEach(c => Plotly.purge(c));
    host.innerHTML = "";
    drawButtons();
    $("empty").style.display = selected.length ? "none" : "block";
    $("tablewrap").style.display = selected.length ? "block" : "none";
    $("sub").textContent = selected.length
      ? "Showing " + selected.map(v => D.panels[v].title.toLowerCase()).join(" and ") + ". Hover a point for the change, click it for its sources. Dashed lines mark the allocation dates that make era cuts."
      : "A dated record of changes in allocation policy, donor matching, immunosuppression, rejection management, surgical practice and registry forms.";
    document.title = (selected.length ? selected.map(v => D.panels[v].title).join(" + ") + " - " : "") + "Practice changes in US pediatric heart and lung transplantation, 1987-2026";
    keys.forEach(k => drawPanel(k, host));
    drawTable(keys);
    $("built").textContent = "Built " + D.built + " from PubMed, Europe PMC, FDA records, OPTN documents and OPTN/SRTR annual data reports. No patient data.";
  }

  document.addEventListener("click", ev => {
    const b = ev.target.closest("button.tog");
    if (!b) return;
    if (b.dataset.view) {
      const next = selected.includes(b.dataset.view) ? selected.filter(v => v !== b.dataset.view) : selected.concat(b.dataset.view);
      location.hash = next.length ? VIEWS.filter(v => next.includes(v)).join("+") : "none";   // triggers render()
    } else if (b.dataset.status) {
      shownStatus.has(b.dataset.status) ? shownStatus.delete(b.dataset.status) : shownStatus.add(b.dataset.status);
      render();
    } else {
      const t = Number(b.dataset.tier);
      shownTier.has(t) ? shownTier.delete(t) : shownTier.add(t);
      render();
    }
  });
  // Search: redraw 250 ms after the last keystroke, so typing stays smooth.
  let timer = null;
  $("q").addEventListener("input", ev => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = ev.target.value.toLowerCase().split(/\s+/).filter(Boolean); render(); }, 250);
  });
  window.addEventListener("hashchange", render);
  render();
})();
