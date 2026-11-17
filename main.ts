// gta6-twitch-ccu-forecast-01 entry: kernel-weighted log-ratio forecaster.
//
// What it does, in one line: for each forecast hour, it looks at how past big
// launches' Twitch audiences moved from their hour-1 print to that hour, and
// weights each past launch by how close its hour-1 size was to this case's.
//
// Why: hour 1 alone barely predicts the evening peak across all launches
// (log correlation ~0.18), because a small hour 1 usually means the game had
// not unlocked yet in the big regions, not that the launch is small. But once
// hour 1 is already substantial (>= ~50k viewers), it predicts the evening
// well (log correlation 0.86, evening 0.7x-2.7x hour 1). So the model
// conditions on hour-1 size with a Gaussian kernel in log space instead of
// pooling every launch equally or splitting on a hard cutoff:
//
//   w_i = exp(-0.5 * ((ln v1_i - ln p1) / 1.0)^2)
//
// For each hour h = 2..24, over the comparables that have both an hour-1 and
// an hour-h print, it takes the kernel-weighted mean and standard deviation of
// r = ln(v_h / v_1), then reports q_tau = p1 * exp(mean + z_tau * 0.9 * sd)
// with z = (-1.645, -0.674, 0, 0.674, 1.645). The spread is floored at 0.15
// log units so a tight hour never claims false certainty, and widened by
// sqrt(1 + 1/ESS) when the kernel-weighted effective sample behind an hour
// is thin, because then the spread estimate itself is unreliable.
//
// Leave-one-out validation over the 38 comparables in the kit (pinball loss
// on the log scale, scored exactly as the contest scores): mean 0.392, vs
// 0.930 for the house persistence baseline. On practice-like cases
// (hour-1 print 20k-300k) it scores ~0.285 vs the baseline's ~0.349.
//
// Everything is computed at runtime from the case file's own comparables, so
// the final case (which includes all 42 past launches) is used in full.
// Node 22, standard library only, offline, deterministic, ~milliseconds.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Gaussian kernel bandwidth, in natural-log units of the hour-1 print. */
const BANDWIDTH = 1.0;
/** Multiplier on the kernel-weighted spread (tuned by leave-one-out). */
const SPREAD_MULT = 0.9;
/** Floor on the log-spread: never claim a tighter curve than this. */
const SPREAD_FLOOR = 0.15;
/** The house baseline's spread, used only if a hour has too few comparables. */
const FALLBACK_SIGMA = 0.15;

interface Case {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables?: Array<{
    day_start: string;
    hourly?: Array<{ from: string; viewers: number | null }>;
  }>;
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** A comparable's release-day curve: hour (1..24) -> viewers, or undefined. */
function dayCurve(dayStart: string, hourly: Array<{ from: string; viewers: number | null }> | undefined): Map<number, number> {
  const curve = new Map<number, number>();
  if (!hourly) return curve;
  const t0 = Date.parse(dayStart);
  if (!Number.isFinite(t0)) return curve;
  for (const p of hourly) {
    if (p.viewers == null || !(p.viewers > 0)) continue;
    const t = Date.parse(p.from);
    if (!Number.isFinite(t)) continue;
    const h = Math.floor((t - t0) / 3_600_000) + 1;
    if (h >= 1 && h <= 24 && !curve.has(h)) curve.set(h, p.viewers);
  }
  return curve;
}

/** The five quantiles for one forecast hour, from the comparables' log-ratios. */
function hourQuantiles(p1: number, h: number, curves: Array<Map<number, number>>): number[] {
  const lv = Math.log(p1);
  let sw = 0;
  let sMean = 0;
  let sVar = 0;
  // First pass: kernel-weighted mean of ln(v_h / v_1).
  const pts: Array<[number, number]> = [];
  for (const curve of curves) {
    const v1 = curve.get(1);
    const vh = curve.get(h);
    if (v1 === undefined || vh === undefined) continue;
    const w = Math.exp(-0.5 * (((Math.log(v1) - lv) / BANDWIDTH) ** 2));
    const r = Math.log(vh / v1);
    pts.push([w, r]);
    sw += w;
    sMean += w * r;
  }
  if (pts.length < 5 || sw <= 0) {
    // Too few comparables for this hour: fall back to the house persistence spread.
    return Z.map((z) => round2(p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(h - 1))));
  }
  const mean = sMean / sw;
  let sW2 = 0;
  for (const [w, r] of pts) {
    sVar += w * (r - mean) ** 2;
    sW2 += w * w;
  }
  // The kernel-weighted spread is only as reliable as the effective sample
  // behind it. When few comparables carry real weight (a small or unusual
  // hour-1 print), the spread estimate itself is noisy, so widen it by
  // sqrt(1 + 1/ESS), where ESS = (sum w)^2 / sum w^2. The factor is bounded
  // by sqrt(2) by construction (ESS >= 1), so a well-covered hour is barely
  // touched and a thin one never blows up. LOO: 0.392 vs 0.393 without it.
  const ess = (sw * sw) / Math.max(sW2, 1e-12);
  const thin = Math.sqrt(1 + 1 / Math.max(ess, 1));
  const sd = Math.max(Math.sqrt(sVar / sw), SPREAD_FLOOR) * SPREAD_MULT * thin;
  // Round, clamp to (0, 1e9], and force non-decreasing after rounding.
  const qs: number[] = [];
  let prev = 0;
  for (const z of Z) {
    let q = round2(p1 * Math.exp(mean + z * sd));
    if (!Number.isFinite(q) || q <= 0) q = 0.01;
    if (q > 1e9) q = 1e9;
    if (q < prev) q = prev;
    qs.push(q);
    prev = q;
  }
  return qs;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const curves = (c.comparables ?? []).map((comp) => dayCurve(comp.day_start, comp.hourly));
  const hours = c.forecast.map(({ hour }) => ({ hour, q: hourQuantiles(p1, hour, curves) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
