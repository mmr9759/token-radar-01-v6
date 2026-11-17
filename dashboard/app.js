// Token Launch Radar v6 — dashboard logic. Reads window.RADAR (data.js).
(function () {
  const D = window.RADAR;
  if (!D) { document.body.innerHTML = "<p>No data.</p>"; return; }
  const rows = D.rows, live = D.live, tests = D.blind_tests, model = D.model;
  const $ = (id) => document.getElementById(id);
  const money = (n) => {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
    return "$" + n.toFixed(2);
  };
  const curveStr = model.curve.a.toFixed(3) + (model.curve.b < 0 ? " − " : " + ") + Math.abs(model.curve.b).toFixed(3);
  const pct = (x) => (x * 100).toFixed(0) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  $("asof").textContent = "Snapshot " + D.as_of + " · " + rows.length + " rows · " + tests.leave_one_out.n + " traded comps";
  $("count").textContent = "· " + rows.length + " rows";

  // ---- Blind tests ---------------------------------------------------------
  function testCard(t) {
    const cut = ((1 - t.curveMedian / t.flatMedian) * 100).toFixed(0);
    return `<div class="test"><h3>${esc(t.name)}</h3>
      <div class="big">${t.curveMedian.toFixed(2)} <span class="vs">median log error — vs flat multiple ${t.flatMedian.toFixed(2)} (${cut}% lower)</span></div>
      <p>Model (curve + category): ${t.modelMedian.toFixed(2)} median error. Within 2x of the true market cap: curve ${pct(t.curveWithin2x)}, flat ${pct(t.flatWithin2x)}, model ${pct(t.modelWithin2x)}. n = ${t.n} traded tokens.</p></div>`;
  }
  $("testgrid").innerHTML = testCard(tests.leave_one_out) + testCard(tests.walk_forward);
  $("testnote").textContent = "Error is |log(predicted / actual market cap)|. A flat multiple is the baseline: the fitted curve beats it blind in both tests, so the curve — not a flat multiple — prices the board.";

  // ---- Board ---------------------------------------------------------------
  const cats = [...new Set(rows.map((r) => r.category || "Unknown"))].sort();
  $("fcat").innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  let sortKey = "implied_value_usd", sortDir = -1;
  let filtered = rows.slice();

  function applyFilters() {
    const q = $("q").value.trim().toLowerCase();
    const fc = $("fcat").value, fr = $("fready").value, fv = $("fverdict").value;
    filtered = rows.filter((r) =>
      (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
      (!fc || (r.category || "Unknown") === fc) &&
      (!fr || r.readiness_band === fr) &&
      (!fv || r.farm_verdict === fv));
    sortRows();
  }
  function sortRows() {
    filtered.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const c = typeof av === "string" ? String(av).localeCompare(String(bv)) : av - bv;
      return sortDir * c;
    });
    renderRows();
  }
  function bandClass(b) { return b === "Hot" ? "hot" : b === "Warming" ? "warming" : "early"; }
  function verdictClass(v) { return v === "FARM" ? "farm" : v === "THIN" ? "thin" : "skip"; }
  function renderRows() {
    $("rows").innerHTML = filtered.map((r) => `<tr data-slug="${esc(r.slug)}">
      <td>${r.rank}</td><td><b>${esc(r.name)}</b><br><span class="kv">${esc(r.slug)}</span></td>
      <td>${esc(r.category || "—")}</td><td class="num">${money(r.tvl_usd)}</td>
      <td class="num"><b>${money(r.implied_value_usd)}</b></td>
      <td><span class="badge ${bandClass(r.readiness_band)}">${r.readiness_band} ${r.readiness}</span></td>
      <td>${r.rank_lo}–${r.rank_hi}</td><td class="${verdictClass(r.farm_verdict)}">${r.farm_verdict}</td></tr>`).join("");
  }
  $("q").addEventListener("input", applyFilters);
  $("fcat").addEventListener("change", applyFilters);
  $("fready").addEventListener("change", applyFilters);
  $("fverdict").addEventListener("change", applyFilters);
  $("sortBtn").addEventListener("click", () => {
    sortDir = -sortDir;
    $("sortBtn").textContent = "Sort: implied " + (sortDir < 0 ? "↓" : "↑");
    sortRows();
  });
  document.querySelectorAll("#board th").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "name" || k === "category" ? 1 : -1; }
      sortRows();
    });
  });
  $("rows").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.dataset.slug);
  });

  // ---- Detail --------------------------------------------------------------
  function showDetail(slug, scroll) {
    const r = rows.find((x) => x.slug === slug);
    if (!r) return;
    const d = $("detail");
    d.classList.remove("hidden");
    $("dname").textContent = "#" + r.rank + " " + r.name + " — " + money(r.implied_value_usd);
    $("dbody").innerHTML = `
      <p class="plain">${esc(r.name)} records no token. Category ${esc(r.category || "—")}, TVL ${money(r.tvl_usd)}, 7-day change ${r.change_7d === null ? "unreported" : r.change_7d + "%"}, tracked since ${esc(r.listed_at || "unknown")}. Readiness ${r.readiness} (${r.readiness_band}).</p>
      <div class="deriv">
        <div><div class="k">TVL</div><div class="v">${money(r.tvl_usd)}</div></div>
        <div><div class="k">Curve multiple</div><div class="v">${r.curve_multiple.toFixed(4)} <small>at this TVL</small></div></div>
        <div><div class="k">Category factor</div><div class="v">×${r.category_factor.toFixed(3)} <small>${r.category_comps} comps</small></div></div>
        <div><div class="k">Growth × maturity</div><div class="v">×${r.growth_factor.toFixed(3)} × ${r.maturity_factor.toFixed(3)}</div></div>
        <div><div class="k">Implied value</div><div class="v">${money(r.implied_value_usd)}</div></div>
        <div><div class="k">Rank range (200 refits)</div><div class="v">${r.rank_lo}–${r.rank_hi} <small>10th–90th pct</small></div></div>
      </div>
      <p class="kv">Derivation, recomputed from the raw figures: ${money(r.tvl_usd)} × ${r.curve_multiple.toFixed(4)} × ${r.category_factor.toFixed(3)} × ${r.growth_factor.toFixed(3)} × ${r.maturity_factor.toFixed(3)} = <b>${money(r.implied_value_usd)}</b>. The curve is log(multiple) = ${curveStr} × log(TVL), fitted on ${model.curve.n} traded tokens; the category factor is the median residual of ${esc(r.category || "Unknown")} against that curve, shrunk toward 1 (K = 6).</p>
      <h3>Farm plan — costed to the dollar</h3>
      <p class="kv">Total cost <b>${money(r.farm_cost_usd)}</b> in gas for 5 actions · expected share <b>${money(r.farm_expected_usd)}</b> · <b class="${verdictClass(r.farm_verdict)}">${r.farm_verdict}</b> (${r.farm_ratio.toFixed(1)}x the cost)</p>
      <ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
    if (scroll === "instant") d.scrollIntoView({ behavior: "auto", block: "start" });
    else if (scroll !== false) d.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Live ----------------------------------------------------------------
  $("liverows").innerHTML = live.map((p) => `<tr>
    <td><b>${esc(p.name)}</b><br><span class="kv">${esc(p.slug)}</span></td>
    <td>${esc(p.category || "—")}</td><td class="num">${money(p.tvl_usd)}</td>
    <td class="num">${money(p.mcap_usd)}</td><td class="num">${(p.mcap_usd / p.tvl_usd).toFixed(3)}</td></tr>`).join("");

  // ---- Method --------------------------------------------------------------
  $("method").textContent =
    "Implied value = TVL × curve(TVL) × category factor × growth × maturity. The curve is log(multiple) = " +
    curveStr + " × log(TVL), fitted by least squares on " +
    model.curve.n + " traded tokens with sane multiples (0.005–5). A category's factor is its median residual against the curve, shrunk toward 1 with K = 6, so a one-comp category cannot set the board. " +
    "Growth is 1 + 0.5 × clamp(7-day change, −30, +60)/100; maturity is 0.90 + 0.10 × min(age, 730)/730. " +
    "Readiness is age (up to 60) plus growth (up to 40). Rank ranges come from 200 bootstrap refits of the comps. " +
    "Farm plans cost a $1,000 standard ticket: gas per action by chain, an expected share of 5% of implied value across an estimated farmer count (TVL / $5,000), and a FARM / THIN / SKIP verdict at 3x / 1x cost. " +
    "The board holds the 40 watchlist protocols plus the 160 largest pre-token protocols below the $50M floor, excluding bridges, CEXs and exchange products.";

  applyFilters();
  // Deep-linkable filters: ?cat=Dexs&ready=Hot&verdict=FARM&q=steak
  const params = new URLSearchParams(location.search);
  if (params.get("cat")) { $("fcat").value = params.get("cat"); applyFilters(); }
  if (params.get("ready")) { $("fready").value = params.get("ready"); applyFilters(); }
  if (params.get("verdict")) { $("fverdict").value = params.get("verdict"); applyFilters(); }
  if (params.get("q")) { $("q").value = params.get("q"); applyFilters(); }
  if (params.get("detail")) showDetail(params.get("detail"), "instant");
  else if (rows.length) showDetail(rows[0].slug, false);
})();
