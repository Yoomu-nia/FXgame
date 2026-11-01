/**
 * tools/calibrate.mjs — 行情参数校准（文档 §3.3 要求"必须通过模拟测试校准"）
 *
 * 用给定模型跑大量随机回合，统计：
 *   1. 单根 K 线的波动幅度（pips）
 *   2. 60 秒回合内价格的总波动（相对开仓价的百分比）
 *   3. 不同杠杆下触发强平的概率（浮动亏损 ≥ 累计保证金 × 90%）
 *   4. 高杠杆下的盈亏幅度（相对保证金）
 *
 * 关键推导（与交易模块的公式一致）：
 *   浮动盈亏 P = N × (ΔP/P) × D，N = M × L
 *   →  P / M = L × (ΔP/P)
 *   →  强平条件 |P| / M ≥ 90% 等价于价格不利变动 ≥ 90% / L
 *   也就是说：**强平距离只由杠杆决定，与投入比例无关**。
 *     100 倍 → 0.90%      50 倍 → 1.80%
 *      20 倍 → 4.50%      10 倍 → 9.00%
 *
 * 运行：node tools/calibrate.mjs
 */

import { DIFFICULTIES, DIFFICULTY_ORDER, GAME } from "../assets/js/config.js";
import { generateSeries, pickPair, createSeed } from "../assets/js/market.js";

const ROUNDS = 3000;
const ENTRY_INDEX = GAME.historyCandles - 1; // 玩家在"第 30 根收盘价"开仓
const LIQUIDATION_RATIO = GAME.liquidationRatio;

const LEVERAGES = [10, 20, 50, 100];

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function pips(value, price) {
  return (value / price) * 10000;
}

function simulate(difficultyId) {
  const rows = [];

  for (let i = 0; i < ROUNDS; i++) {
    const seed = createSeed();
    const pair = pickPair(seed);
    const { candles } = generateSeries({ seed, pair, difficultyId });

    const entry = candles[ENTRY_INDEX].close;
    const reveal = candles.slice(ENTRY_INDEX); // 开仓后的价格路径

    let minPrice = entry;
    let maxPrice = entry;
    for (const c of reveal) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    const finalClose = candles[candles.length - 1].close;
    const ret = (finalClose - entry) / entry; // 收盘收益率（做多视角）
    const maeLong = (minPrice - entry) / entry; // 最不利（负）
    const mfeLong = (maxPrice - entry) / entry; // 最有利（正）

    // 逐根振幅（实体 + 影线），换算成 pips
    let rangeSum = 0;
    for (const c of reveal) rangeSum += (c.high - c.low) / c.close;
    const avgRangePct = rangeSum / reveal.length;

    rows.push({
      ret,
      absRet: Math.abs(ret),
      maeLong,
      mfeLong,
      // 做空视角的最不利变动 = 价格上涨幅度
      maeShort: (entry - maxPrice) / entry,
      avgRangePct: avgRangePct * 100,
      price: entry,
      avgRangePips: pips(avgRangePct * entry, entry),
    });
  }

  const sortedAbsRet = rows.map((r) => r.absRet).sort((a, b) => a - b);
  const sortedRet = rows.map((r) => r.ret).sort((a, b) => a - b);

  const liquidation = {};
  for (const L of LEVERAGES) {
    const threshold = LIQUIDATION_RATIO / L;
    const hits = rows.filter(
      (r) => Math.abs(r.maeLong) >= threshold || Math.abs(r.maeShort) >= threshold
    ).length;
    liquidation[L] = (hits / rows.length) * 100;
  }

  return {
    difficultyId,
    name: DIFFICULTIES[difficultyId].name,
    rounds: rows.length,
    pipsPerCandle: rows.reduce((s, r) => s + r.avgRangePips, 0) / rows.length,
    medianAbsRet: percentile(sortedAbsRet, 0.5) * 100,
    p90AbsRet: percentile(sortedAbsRet, 0.9) * 100,
    p50Ret: percentile(sortedRet, 0.5) * 100,
    p10Ret: percentile(sortedRet, 0.1) * 100,
    p90Ret: percentile(sortedRet, 0.9) * 100,
    liquidation,
  };
}

console.log(`\n行情校准：每档难度 ${ROUNDS} 个随机回合，开仓点＝第 ${ENTRY_INDEX + 1} 根收盘价\n`);

const results = DIFFICULTY_ORDER.map(simulate);

/* ---------- 表 1：波动幅度 ---------- */
console.log("【表 1】波动幅度");
console.log("难度  平均单根振幅  回合|收益|中位数  回合|收益|P90   收益P10～P90");
for (const r of results) {
  console.log(
    `${r.name.padEnd(4, "　")}  ${r.pipsPerCandle.toFixed(1).padStart(8)} pips` +
      `  ${(r.medianAbsRet.toFixed(3) + "%").padStart(12)}` +
      `  ${(r.p90AbsRet.toFixed(3) + "%").padStart(12)}` +
      `   ${r.p10Ret.toFixed(2)}% ～ ${r.p90Ret.toFixed(2)}%`
  );
}

/* ---------- 表 2：强平概率 ---------- */
console.log("\n【表 2】60 秒内触发强平的概率（按杠杆，与投入比例无关）");
console.log("难度    " + LEVERAGES.map((L) => `${L}倍(${(LIQUIDATION_RATIO / L) * 100}%)`.padStart(13)).join(""));
for (const r of results) {
  console.log(
    r.name.padEnd(4, "　") +
      " " +
      LEVERAGES.map((L) => `${r.liquidation[L].toFixed(1)}%`.padStart(13)).join("")
  );
}

/* ---------- 表 3：盈亏相当于保证金的多少 ---------- */
console.log("\n【表 3】回合结束时，浮动盈亏相当于保证金的百分比（绝对值中位数）");
console.log("难度    " + LEVERAGES.map((L) => `${L}倍`.padStart(11)).join(""));
for (const r of results) {
  // 用 |收益| 中位数 × 杠杆 ≈ 该杠杆下典型盈亏幅度
  const values = LEVERAGES.map((L) => `${(r.medianAbsRet * L).toFixed(1)}%`.padStart(11));
  console.log(r.name.padEnd(4, "　") + " " + values.join(""));
}

console.log("\n提示：改 market.js 的 MODEL.MOVE_SCALE 会整体放大/缩小行情幅度（1.0 = 当前设置）。\n");
