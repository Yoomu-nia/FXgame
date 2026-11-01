/**
 * tools/selftest.mjs — 行情模块自检（阶段二验收用）
 *
 * 检查内容：
 *   1. 同一随机种子 → 两次生成的 K 线完全一致（可复现）
 *   2. 不同种子 → 行情不同
 *   3. K 线结构合法：high ≥ max(open, close)、low ≤ min(open, close)、时间递增
 *   4. 根数正确：30 根历史 + 难度对应的揭示根数（普通 15 / 困难 30 / 极限 60）
 *   5. 三档难度参数与文档 §3.3 一致
 *   6. 同一回合重复读取不会改变已生成的数据（无副作用）
 *
 * 运行：node tools/selftest.mjs
 */

import { GAME, DIFFICULTIES, DIFFICULTY_ORDER, PAIRS } from "../assets/js/config.js";
import {
  generateSeries,
  pickPair,
  createSeed,
  normalizeSeed,
  createRandom,
  revealCountFor,
  sigmaFor,
} from "../assets/js/market.js";

let failures = 0;
let checks = 0;

function check(name, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sameSeries(a, b) {
  if (a.length !== b.length) return false;
  return a.every((candle, i) => {
    const other = b[i];
    return (
      candle.time === other.time &&
      candle.open === other.open &&
      candle.high === other.high &&
      candle.low === other.low &&
      candle.close === other.close
    );
  });
}

/* -------------------------------------------------------------------------- */
console.log("\n【1】可复现性");
/* -------------------------------------------------------------------------- */

{
  const seed = "7A3F9C21";
  const difficultyId = "hard";
  const pair = pickPair(seed);
  const a = generateSeries({ seed, pair, difficultyId });
  const b = generateSeries({ seed, pair, difficultyId });

  check(`同一组参数两次生成完全一致（${a.candles.length} 根）`, sameSeries(a.candles, b.candles));
  check("货币对由种子确定（两次相同）", a.pair.symbol === b.pair.symbol, `${a.pair.symbol} vs ${b.pair.symbol}`);

  // 只换种子，其余不变
  const other = generateSeries({ seed: "12345678", pair: pickPair("12345678"), difficultyId });
  check("不同种子生成的行情不同", !sameSeries(a.candles, other.candles));

  // 生成两遍不影响已生成数据（纯函数，无副作用）
  const snapshot = JSON.stringify(a.candles);
  generateSeries({ seed, pair, difficultyId });
  check("重复生成不修改已有数据", JSON.stringify(a.candles) === snapshot);
}

/* -------------------------------------------------------------------------- */
console.log("\n【2】K 线结构合法性");
/* -------------------------------------------------------------------------- */

{
  for (const difficultyId of DIFFICULTY_ORDER) {
    let ok = true;
    let detail = "";
    for (let i = 0; i < 50; i++) {
      const seed = createSeed();
      const pair = pickPair(seed);
      const { candles } = generateSeries({ seed, pair, difficultyId });
      for (let j = 0; j < candles.length; j++) {
        const c = candles[j];
        if (!(c.high >= Math.max(c.open, c.close) - 1e-9)) {
          ok = false;
          detail = `${difficultyId} 第 ${j} 根 high < max(open,close)`;
          break;
        }
        if (!(c.low <= Math.min(c.open, c.close) + 1e-9)) {
          ok = false;
          detail = `${difficultyId} 第 ${j} 根 low > min(open,close)`;
          break;
        }
        if (!(c.low > 0) || !(c.close > 0)) {
          ok = false;
          detail = `${difficultyId} 第 ${j} 根出现非正价格`;
          break;
        }
        if (j > 0 && !(c.time > candles[j - 1].time)) {
          ok = false;
          detail = `${difficultyId} 第 ${j} 根时间未递增`;
          break;
        }
      }
      if (!ok) break;
    }
    check(`${DIFFICULTIES[difficultyId].name}：50 个回合结构全部合法`, ok, detail);
  }
}

/* -------------------------------------------------------------------------- */
console.log("\n【3】根数与难度参数");
/* -------------------------------------------------------------------------- */

{
  const expected = { normal: 15, hard: 30, extreme: 60 };
  for (const difficultyId of DIFFICULTY_ORDER) {
    const seed = "BBBB1111";
    const pair = pickPair(seed);
    const data = generateSeries({ seed, pair, difficultyId });
    const reveal = data.candles.length - data.historyCount;

    check(
      `${DIFFICULTIES[difficultyId].name}：初始历史 ${data.historyCount} 根`,
      data.historyCount === GAME.historyCandles,
      `实际 ${data.historyCount}`
    );
    check(
      `${DIFFICULTIES[difficultyId].name}：揭示 ${reveal} 根（60 秒 ÷ ${DIFFICULTIES[difficultyId].candleIntervalMs / 1000}s）`,
      reveal === expected[difficultyId],
      `实际 ${reveal}`
    );
  }

  const docParams = {
    normal: [40, 60, 5, 4000],
    hard: [70, 40, 15, 2000],
    extreme: [95, 20, 25, 1000],
  };
  for (const difficultyId of DIFFICULTY_ORDER) {
    const d = DIFFICULTIES[difficultyId];
    const [vol, trend, shock, speed] = docParams[difficultyId];
    check(
      `${d.name} 参数符合需求文档 §3.3`,
      d.volatility === vol && d.trend === trend && d.shockProb === shock && d.candleIntervalMs === speed,
      `实际 ${d.volatility}/${d.trend}/${d.shockProb}/${d.candleIntervalMs}`
    );
  }
}

/* -------------------------------------------------------------------------- */
console.log("\n【4】随机数与种子工具");
/* -------------------------------------------------------------------------- */

{
  const a = createRandom("SAME-SEED");
  const b = createRandom("SAME-SEED");
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  check("同一种子的随机数序列一致", seqA.every((v, i) => v === seqB[i]));

  const g = createRandom("GAUSS");
  const samples = Array.from({ length: 20000 }, () => g.gauss());
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
  check(
    "高斯分布均值≈0、标准差≈1（Box-Muller 正确）",
    Math.abs(mean) < 0.03 && Math.abs(Math.sqrt(variance) - 1) < 0.03,
    `mean=${mean.toFixed(3)} sd=${Math.sqrt(variance).toFixed(3)}`
  );

  check("种子会统一转成大写并过滤非法字符", normalizeSeed(" ab-c9! ") === "AB-C9");
  check("空种子返回空串（由调用方补新种子）", normalizeSeed("") === "" || normalizeSeed("") === "");

  check("四种货币对都能被选中", (() => {
    const seen = new Set();
    for (let i = 0; i < 4000; i++) seen.add(pickPair(createSeed()).symbol);
    return seen.size === PAIRS.length;
  })());

  check(
    "波动率映射单调递增（普通 < 困难 < 极限）",
    sigmaFor(40) < sigmaFor(70) && sigmaFor(70) < sigmaFor(95),
    `${sigmaFor(40).toFixed(6)} / ${sigmaFor(70).toFixed(6)} / ${sigmaFor(95).toFixed(6)}`
  );

  check(
    "揭示根数计算与难度速度匹配",
    revealCountFor("normal") === 15 && revealCountFor("hard") === 30 && revealCountFor("extreme") === 60
  );
}

/* -------------------------------------------------------------------------- */
console.log(
  `\n结果：${checks - failures} / ${checks} 项通过${failures ? `，${failures} 项失败` : ""}\n`
);
process.exit(failures ? 1 : 0);
