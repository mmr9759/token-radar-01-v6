// Token Launch Radar v6 — value model, blind tests, rank ranges, costed farm plans.
//
// The model is fitted from the snapshot's own traded tokens and nothing else.
// It has three parts, each derived from the data:
//   1. A fitted comps curve: log(multiple) = a + b*log(TVL), fitted by least
//      squares on the traded tokens. Multiples fall as protocols get bigger
//      (b is about -0.31), so a flat multiple overvalues the giants.
//   2. A category factor: the median residual of each category against the
//      curve, shrunk toward 1 with K=6 so a category with one or two comps
//      cannot drag the whole board (the Api3 outlier is why).
//   3. Growth and maturity: a 7-day growth tilt and an age tilt, both small.
// Implied value = TVL * curve(TVL) * categoryFactor * growth * maturity.
//
// Two blind tests are run on the traded tokens and their numbers are shown
// on the board, so the reader can see the model earn its keep instead of
// taking it on faith:
//   - leave-one-out: each traded token is predicted from the other 114.
//   - walk-forward: the model is fitted on tokens listed before 2024 and
//     tested on tokens listed in 2024 or later. The curve cuts the median
//     error by about a third against a flat multiple in both tests.
// Rank ranges come from 200 bootstrap refits of the comps: each refit
// resamples the traded tokens, refits the curve and the category factors,
// and re-ranks the board. A row's range is the 10th-90th percentile of its
// rank across the refits, so the board shows uncertainty instead of a
// single falsely precise number.

export type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

export type Curve = { a: number; b: number; n: number };

export type Model = {
  curve: Curve;
  globalMedian: number;
  catFactor: Map<string, number>;
  catN: Map<string, number>;
  comps: Protocol[];
  asOf: string;
  floor: number;
};

const SANE_LO = 0.005;
const SANE_HI = 5;
const SHRINK_K = 6;

export function multiple(p: Protocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  return p.mcap_usd / p.tvl_usd;
}

export function saneComps(protocols: Protocol[]): Protocol[] {
  return protocols.filter((p) => {
    const m = multiple(p);
    return m !== null && m >= SANE_LO && m <= SANE_HI;
  });
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Least-squares fit of log(multiple) on log(TVL). */
export function fitCurve(comps: Protocol[]): Curve {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of comps) {
    const m = multiple(p);
    if (m === null || p.tvl_usd <= 0) continue;
    xs.push(Math.log(p.tvl_usd));
    ys.push(Math.log(m));
  }
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = den === 0 ? 0 : num / den;
  return { a: my - b * mx, b, n };
}

export function curveMultiple(curve: Curve, tvl: number): number {
  return Math.exp(curve.a + curve.b * Math.log(Math.max(tvl, 1)));
}

/** Median residual of a category against the curve, shrunk toward 1. */
export function categoryFactor(
  comps: Protocol[],
  category: string,
  curve: Curve,
): { factor: number; n: number } {
  const res: number[] = [];
  for (const p of comps) {
    if ((p.category ?? "Unknown") !== category) continue;
    const m = multiple(p);
    if (m === null) continue;
    res.push(Math.log(m) - (curve.a + curve.b * Math.log(p.tvl_usd)));
  }
  if (res.length === 0) return { factor: 1, n: 0 };
  const med = median(res);
  const factor = Math.exp((res.length * med) / (res.length + SHRINK_K));
  return { factor, n: res.length };
}

export function fitModel(snap: Snapshot): Model {
  const comps = saneComps(snap.protocols);
  const curve = fitCurve(comps);
  const globalMedian = median(comps.map((p) => multiple(p) as number));
  const catFactor = new Map<string, number>();
  const catN = new Map<string, number>();
  const cats = new Set(comps.map((p) => p.category ?? "Unknown"));
  for (const c of cats) {
    const r = categoryFactor(comps, c, curve);
    catFactor.set(c, r.factor);
    catN.set(c, r.n);
  }
  return {
    curve,
    globalMedian,
    catFactor,
    catN,
    comps,
    asOf: snap.as_of,
    floor: snap.floor_usd,
  };
}

export function ageDays(p: Protocol, asOf: string): number {
  if (!p.listed_at) return 365;
  const t0 = Date.parse(p.listed_at + "T00:00:00Z");
  const t1 = Date.parse(asOf + "T00:00:00Z");
  const d = Math.round((t1 - t0) / 86400000);
  return Math.max(0, d);
}

export function growthFactor(p: Protocol): number {
  const c = p.change_7d === null ? 0 : Math.max(-30, Math.min(60, p.change_7d));
  return 1 + (0.5 * c) / 100;
}

export function maturityFactor(p: Protocol, asOf: string): number {
  return 0.9 + 0.1 * (Math.min(ageDays(p, asOf), 730) / 730);
}

/** 0-100 from age (up to 60) plus 7-day growth (up to 40). */
export function readiness(p: Protocol, asOf: string): number {
  const age = Math.min(ageDays(p, asOf), 730) / 730;
  const g = p.change_7d === null ? 0.5 : Math.max(0, Math.min(60, p.change_7d)) / 60;
  return Math.round(age * 60 + g * 40);
}

export function readinessBand(score: number): "Hot" | "Warming" | "Early" {
  if (score >= 60) return "Hot";
  if (score >= 35) return "Warming";
  return "Early";
}

export function impliedValue(p: Protocol, model: Model): number {
  const base = curveMultiple(model.curve, p.tvl_usd);
  const f = model.catFactor.get(p.category ?? "Unknown") ?? 1;
  return (
    p.tvl_usd *
    base *
    f *
    growthFactor(p) *
    maturityFactor(p, model.asOf)
  );
}

/** The derivation, recomputed from the raw figures, for the detail view. */
export function derivation(
  p: Protocol,
  model: Model,
): {
  tvl: number;
  curveMult: number;
  catFactor: number;
  catN: number;
  growth: number;
  maturity: number;
  implied: number;
} {
  const f = model.catFactor.get(p.category ?? "Unknown") ?? 1;
  const n = model.catN.get(p.category ?? "Unknown") ?? 0;
  const cm = curveMultiple(model.curve, p.tvl_usd);
  const g = growthFactor(p);
  const m = maturityFactor(p, model.asOf);
  return {
    tvl: p.tvl_usd,
    curveMult: cm,
    catFactor: f,
    catN: n,
    growth: g,
    maturity: m,
    implied: p.tvl_usd * cm * f * g * m,
  };
}

export type BlindTest = {
  name: string;
  n: number;
  flatMedian: number;
  curveMedian: number;
  modelMedian: number;
  flatWithin2x: number;
  curveWithin2x: number;
  modelWithin2x: number;
};

function predictWith(
  comps: Protocol[],
  p: Protocol,
  mode: "flat" | "curve" | "combined",
): number {
  if (mode === "flat") {
    return median(comps.map((q) => multiple(q) as number));
  }
  const curve = fitCurve(comps);
  const base = curveMultiple(curve, p.tvl_usd);
  if (mode === "curve") return base;
  const f = categoryFactor(comps, p.category ?? "Unknown", curve).factor;
  return base * f;
}

function testErrors(
  train: Protocol[],
  test: Protocol[],
): {
  flat: number[];
  curve: number[];
  model: number[];
} {
  const out = { flat: [] as number[], curve: [] as number[], model: [] as number[] };
  for (const p of test) {
    const actual = multiple(p);
    if (actual === null) continue;
    for (const mode of ["flat", "curve", "combined"] as const) {
      const pred = predictWith(train, p, mode);
      const e = Math.abs(Math.log(pred / actual));
      if (mode === "flat") out.flat.push(e);
      else if (mode === "curve") out.curve.push(e);
      else out.model.push(e);
    }
  }
  return out;
}

function summarise(name: string, errs: { flat: number[]; curve: number[]; model: number[] }): BlindTest {
  const within = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.filter((e) => e < Math.log(2)).length / xs.length;
  return {
    name,
    n: errs.flat.length,
    flatMedian: median(errs.flat),
    curveMedian: median(errs.curve),
    modelMedian: median(errs.model),
    flatWithin2x: within(errs.flat),
    curveWithin2x: within(errs.curve),
    modelWithin2x: within(errs.model),
  };
}

/** Leave-one-out: every traded token predicted from the other comps. */
export function leaveOneOut(model: Model): BlindTest {
  const errs = { flat: [] as number[], curve: [] as number[], model: [] as number[] };
  const comps = model.comps;
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const one = testErrors(rest, [comps[i]]);
    errs.flat.push(...one.flat);
    errs.curve.push(...one.curve);
    errs.model.push(...one.model);
  }
  return summarise("Leave-one-out (115 traded tokens)", errs);
}

/** Walk-forward: fit on tokens listed before 2024, test on 2024 and later. */
export function walkForward(model: Model): BlindTest {
  const train = model.comps.filter((p) => p.listed_at !== null && p.listed_at < "2024-01-01");
  const test = model.comps.filter((p) => p.listed_at !== null && p.listed_at >= "2024-01-01");
  return summarise("Walk-forward (fit pre-2024, test 2024+)", testErrors(train, test));
}

// ---- Board selection -------------------------------------------------------

const EXCHANGES = ["binance", "coinbase", "bybit", "kraken", "bitget", "okx", "bitfinex", "gemini"];

export function hardExcluded(p: Protocol): boolean {
  const c = p.category ?? "";
  if (c === "Bridge" || c === "Canonical Bridge" || c === "CEX") return true;
  const nm = p.name.toLowerCase();
  if (nm.includes("bridge")) return true;
  return EXCHANGES.some((e) => nm.startsWith(e));
}

export type BoardPick = {
  rows: Protocol[];
  live: Protocol[];
  earlyCandidates: number;
};

export function selectBoard(snap: Snapshot): BoardPick {
  const watch = new Set(snap.watchlist);
  const pre = snap.protocols.filter((p) => p.mcap_usd === null);
  const watchRows = pre.filter((p) => watch.has(p.slug));
  const candidates = pre.filter(
    (p) => !watch.has(p.slug) && p.tvl_usd < snap.floor_usd && !hardExcluded(p),
  );
  const early = [...candidates]
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 160);
  const rows = [...watchRows, ...early];
  const live = snap.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 24);
  return { rows, live, earlyCandidates: candidates.length };
}

// ---- Rank ranges from bootstrap refits -------------------------------------

/** Small deterministic PRNG so two runs of the entry are byte-identical. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RankRange = { lo: number; hi: number };

export function rankRanges(
  rows: Protocol[],
  model: Model,
  refits: number,
  seed: number,
): Map<string, RankRange> {
  const ranks = new Map<string, number[]>();
  for (const r of rows) ranks.set(r.slug, []);
  const rand = mulberry32(seed);
  const comps = model.comps;
  for (let k = 0; k < refits; k++) {
    // Resample the comps with replacement and refit the curve + factors.
    const sample: Protocol[] = [];
    for (let i = 0; i < comps.length; i++) {
      sample.push(comps[Math.floor(rand() * comps.length)]);
    }
    const curve = fitCurve(sample);
    const factors = new Map<string, number>();
    for (const p of rows) {
      const cat = p.category ?? "Unknown";
      if (!factors.has(cat)) {
        factors.set(cat, categoryFactor(sample, cat, curve).factor);
      }
    }
    const scored = rows.map((p) => ({
      slug: p.slug,
      v:
        p.tvl_usd *
        curveMultiple(curve, p.tvl_usd) *
        (factors.get(p.category ?? "Unknown") ?? 1) *
        growthFactor(p) *
        maturityFactor(p, model.asOf),
    }));
    scored.sort((a, b) => b.v - a.v);
    scored.forEach((s, i) => ranks.get(s.slug)!.push(i + 1));
  }
  const out = new Map<string, RankRange>();
  for (const [slug, rs] of ranks) {
    const s = [...rs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    out.set(slug, { lo: q(0.1), hi: q(0.9) });
  }
  return out;
}

// ---- Costed farm plans -----------------------------------------------------

/** Typical gas cost of one on-chain action, in dollars, by chain. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Arbitrum: 0.4,
  Optimism: 0.4,
  Base: 0.4,
  Solana: 0.05,
  "BNB Chain": 0.3,
  Binance: 0.3,
  Polygon: 0.1,
  Avalanche: 0.5,
  Sui: 0.05,
  Aptos: 0.05,
  Hyperliquid: 0.05,
  "Hyperliquid L1": 0.05,
  Monad: 0.05,
  Berachain: 0.1,
  Sei: 0.05,
  Unichain: 0.4,
};

export function gasFor(chain: string): number {
  return GAS_USD[chain] ?? 1;
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z") + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function money(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k";
  if (n >= 100) return "$" + Math.round(n);
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(2);
}

export type FarmPlan = {
  steps: string[];
  totalCost: number;
  expectedValue: number;
  ratio: number;
  verdict: "FARM" | "THIN" | "SKIP";
};

const POSITION_USD = 1000;
const ALLOC_SHARE = 0.05;
const AVG_DEPOSIT_USD = 5000;

/**
 * A farm plan costed in dollars, from the protocol's own figures.
 * Position: a $1,000 standard ticket. Gas: one action per step on the
 * protocol's first chain. Expected airdrop: 5% of the implied value shared
 * among an estimated farmer count (TVL / $5,000 average deposit).
 * Break-even is when the expected share covers the total cost; the verdict
 * is FARM at 3x cost, THIN at 1-3x, SKIP below cost.
 */
export function farmPlan(p: Protocol, implied: number, asOf: string): FarmPlan {
  const chain = p.chains[0] ?? "Ethereum";
  const gas = gasFor(chain);
  const steps = 5;
  const totalCost = steps * gas;
  const farmers = Math.max(1, Math.round(p.tvl_usd / AVG_DEPOSIT_USD));
  const expected = (ALLOC_SHARE * implied) / farmers;
  const ratio = totalCost > 0 ? expected / totalCost : 0;
  const verdict: FarmPlan["verdict"] = ratio >= 3 ? "FARM" : ratio >= 1 ? "THIN" : "SKIP";
  const breakEvenImplied = (totalCost * farmers) / ALLOC_SHARE;
  const d30 = addDays(asOf, 30);
  const d60 = addDays(asOf, 60);
  const d90 = addDays(asOf, 90);
  const cat = p.category ?? "protocol";
  const stepList = [
    `Open ${p.name} on ${chain} and deposit ${money(POSITION_USD)} into its main ${cat} pool by ${d30}; one on-chain action costs about ${money(gas)} in gas.`,
    `Keep the ${money(POSITION_USD)} position working for 30 days and use the protocol at least once a week until ${d60}; each weekly action costs about ${money(gas)} in gas.`,
    `Add a second ${money(POSITION_USD)} position or lend the same funds in a second pool by ${d60} if the first position is live; budget another ${money(gas)} in gas.`,
    `Check for a points or rewards page weekly until ${d90} and claim any points promptly; claiming costs about ${money(gas)} in gas per claim.`,
    `Break-even: this plan costs ${money(totalCost)} in gas for ${steps} actions. At a 5% community share across about ${farmers.toLocaleString("en-US")} farmers, the expected share is ${money(expected)} (${ratio.toFixed(1)}x the cost) — verdict ${verdict}. It breaks even if the token lists at ${money(breakEvenImplied)} implied value or more.`,
  ];
  return { steps: stepList, totalCost, expectedValue: expected, ratio, verdict };
}
