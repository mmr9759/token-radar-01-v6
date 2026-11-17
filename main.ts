// Token Launch Radar v6 — entrypoint.
// Reads the sealed snapshot, fits the comps curve, runs the blind tests,
// builds the 200-row board with rank ranges and costed farm plans, and
// writes board.json, data.js, the dashboard, the screenshots and the dossier.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  fitModel,
  impliedValue,
  derivation,
  readiness,
  readinessBand,
  leaveOneOut,
  walkForward,
  selectBoard,
  rankRanges,
  farmPlan,
  money,
  type Snapshot,
  type Protocol,
} from "./lib/model.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const inputPath =
  arg("--input") ??
  (process.env.MAKEFUN_INPUT_DIR
    ? join(process.env.MAKEFUN_INPUT_DIR, "snapshot.json")
    : "/input/snapshot.json");
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const snap: Snapshot = JSON.parse(readFileSync(inputPath, "utf-8"));

// 1. Fit the model from the snapshot's traded tokens.
const model = fitModel(snap);

// 2. Run the blind tests — the numbers the board shows to earn its keep.
const loo = leaveOneOut(model);
const wf = walkForward(model);

// 3. Pick the board: the 40 watchlist rows plus the 160 best early rows
//    below the floor, and the 24 live (already-traded) protocols apart.
const pick = selectBoard(snap);
const scored = pick.rows
  .map((p) => ({ p, implied: impliedValue(p, model) }))
  .sort((a, b) => b.implied - a.implied);

// 4. Rank ranges from 200 bootstrap refits of the comps.
const ranges = rankRanges(
  scored.map((s) => s.p),
  model,
  200,
  20261114,
);

// 5. Build every row: derivation, readiness, rank range, costed farm plan.
type Row = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  readiness: number;
  readiness_band: string;
  rank_lo: number;
  rank_hi: number;
  curve_multiple: number;
  category_factor: number;
  category_comps: number;
  growth_factor: number;
  maturity_factor: number;
  farm_cost_usd: number;
  farm_expected_usd: number;
  farm_ratio: number;
  farm_verdict: string;
  live: boolean;
};

const rows: Row[] = scored.map((s, i) => {
  const p = s.p;
  const d = derivation(p, model);
  const plan = farmPlan(p, s.implied, model.asOf);
  const rr = ranges.get(p.slug) ?? { lo: i + 1, hi: i + 1 };
  return {
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: Math.max(1, Math.round(s.implied)),
    farm_steps: plan.steps,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    readiness: readiness(p, model.asOf),
    readiness_band: readinessBand(readiness(p, model.asOf)),
    rank_lo: rr.lo,
    rank_hi: rr.hi,
    curve_multiple: d.curveMult,
    category_factor: d.catFactor,
    category_comps: d.catN,
    growth_factor: d.growth,
    maturity_factor: d.maturity,
    farm_cost_usd: Math.round(plan.totalCost * 100) / 100,
    farm_expected_usd: Math.round(plan.expectedValue * 100) / 100,
    farm_ratio: Math.round(plan.ratio * 10) / 10,
    farm_verdict: plan.verdict,
    live: false,
  };
});

const liveRows = pick.live.map((p) => ({
  slug: p.slug,
  name: p.name,
  category: p.category,
  chains: p.chains,
  tvl_usd: p.tvl_usd,
  mcap_usd: p.mcap_usd,
  change_7d: p.change_7d,
  listed_at: p.listed_at,
}));

// 6. Write the outputs.
mkdirSync(outDir, { recursive: true });
const board = {
  as_of: model.asOf,
  source: snap.source,
  floor_usd: snap.floor_usd,
  model: {
    curve: {
      a: model.curve.a,
      b: model.curve.b,
      n: model.curve.n,
      formula: "log(multiple) = a + b * log(TVL)",
    },
    global_median_multiple: model.globalMedian,
    shrinkage_k: 6,
    growth: "1 + 0.5 * clamp(change_7d, -30, +60) / 100",
    maturity: "0.90 + 0.10 * min(age_days, 730) / 730",
    readiness: "age up to 60 + growth up to 40; Hot >= 60, Warming 35-59, Early < 35",
  },
  blind_tests: { leave_one_out: loo, walk_forward: wf },
  counts: {
    rows: rows.length,
    watchlist: snap.watchlist.length,
    early_candidates: pick.earlyCandidates,
    live: liveRows.length,
    comps: model.comps.length,
  },
  rows,
  live: liveRows,
};
writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 1) + "\n");

const dataJs =
  "window.RADAR = " + JSON.stringify(board) + ";\n";
writeFileSync(join(outDir, "data.js"), dataJs);

// 7. Copy the dashboard and the screenshots, then write the dossier.
const dashSrc = join(ROOT, "dashboard");
const dashDst = join(outDir, "dashboard");
mkdirSync(dashDst, { recursive: true });
cpSync(dashSrc, dashDst, { recursive: true });
const shotsSrc = join(ROOT, "screenshots");
const shotsDst = join(outDir, "screenshots");
mkdirSync(shotsDst, { recursive: true });
if (existsSync(shotsSrc)) cpSync(shotsSrc, shotsDst, { recursive: true });

writeFileSync(
  join(outDir, "dossier.json"),
  buildDossier(outDir, { text_max_bytes: 65536 }),
);

const top = rows[0];
console.log(
  `radar: ${rows.length} rows, ${snap.watchlist.length} watchlist, ${liveRows.length} live, ` +
    `global multiple ${model.globalMedian.toFixed(4)}, top ${top.name} ${money(top.implied_value_usd)}, ` +
    `LOO curve ${loo.curveMedian.toFixed(2)} vs flat ${loo.flatMedian.toFixed(2)}, ` +
    `WF curve ${wf.curveMedian.toFixed(2)} vs flat ${wf.flatMedian.toFixed(2)}`,
);
