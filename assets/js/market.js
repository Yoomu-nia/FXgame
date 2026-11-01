/**
 * market.js — 行情生成模块（文档 §3.2 / §3.3 / §3.4）
 *
 * 设计要点：
 *   1. 纯函数 + 可复现：同样 (seed, pair, difficulty, 根数) → 完全相同的 K 线序列。
 *   2. 每回合开仓前一次性生成完整序列（文档 §3.4），界面只逐步“揭示”，
 *      未来部分不进入图表、不进入任何显示逻辑。
 *   3. 不含任何与玩家持仓/盈亏相关的输入 —— 行情不可能针对玩家（文档 §3.3 末条）。
 *
 * 这个文件不碰 DOM，可以直接在 Node 里 import 做校准与回归测试（tools/calibrate.mjs）。
 */

import { GAME, PAIRS, DIFFICULTIES } from "./config.js";

/* ==========================================================================
   1. 行情模型参数（校准过的初始值）
   ========================================================================== */

/**
 * σ = SIGMA_BASE + SIGMA_SLOPE × (波动率 / 100)
 *   σ 是“单根 K 线收盘价变动的标准差”，用「占价格的比例」表示，
 *   这样不同价位的货币对（1.0850 / 0.6120）风险感受一致。
 *
 * 代入三档难度（以 EUR/USD 1.0850 为例，1 pip = 0.0001）：
 *   普通 40%  → σ = 0.00065 → 单根约 7.1 pips
 *   困难 70%  → σ = 0.00095 → 单根约 10.3 pips
 *   极限 95%  → σ = 0.00120 → 单根约 13.0 pips
 *
 * 想让整体行情更猛烈/更温和，只改 MOVE_SCALE 一个数即可。
 */
export const MODEL = {
  SIGMA_BASE: 0.00025,
  SIGMA_SLOPE: 0.00100,
  MOVE_SCALE: 1.0,

  // 影线长度：相对 σ 的比例（用 |N(0,1)| 抽取，保证影线长短不一）
  WICK_RATIO: 0.45,

  // 突发事件：倍数区间，额外叠加到本根 K 线上
  SHOCK_MIN: 2.5,
  SHOCK_MAX: 6.0,

  // 价格保留小数位（5 位＝按 0.1 pip 报价）
  PRICE_DECIMALS: 5,

  // 行情起始时间（UTC 秒）。固定值，保证同一回合的时间轴稳定、可复现
  TIME_ORIGIN: Date.UTC(2026, 0, 5, 9, 0, 0) / 1000,
};

/** 当前难度下单根 K 线的 σ（价格比例） */
export function sigmaFor(volatility) {
  const v = Math.max(0, Math.min(100, volatility)) / 100;
  return (MODEL.SIGMA_BASE + MODEL.SIGMA_SLOPE * v) * MODEL.MOVE_SCALE;
}

/* ==========================================================================
   2. 可复现随机数
   ========================================================================== */

/** 字符串 → 32 位整数散列（xmur3） */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/**
 * 用种子字符串创建随机数发生器（mulberry32）。
 * 同一个种子永远产出同一串数字，这是“可复现行情”的基础。
 * @param {string} seed
 * @returns {{ next: () => number, gauss: () => number }}
 */
export function createRandom(seed) {
  const seedFn = xmur3(String(seed));
  let state = seedFn();

  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Box-Muller 标准正态分布
  let spare = null;
  const gauss = () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };

  return { next, gauss };
}

/* ==========================================================================
   3. 种子与货币对
   ========================================================================== */

const SEED_ALPHABET = "0123456789ABCDEF";

/** 生成一个新的随机种子，例如 "7A3F9C21" */
export function createSeed() {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }
  return out;
}

/** 校验种子格式（宽松：1~32 位字母数字，自动转大写） */
export function normalizeSeed(seed) {
  const cleaned = String(seed ?? "").trim().toUpperCase().replace(/[^0-9A-Z_-]/g, "");
  return cleaned.slice(0, 32);
}

/**
 * 由种子决定本回合的货币对（文档 §3.2：每回合随机选择一个）。
 * 用子种子 "seed:pair"，与 K 线序列互不干扰。
 * @param {string} seed
 * @returns {typeof PAIRS[number] & { id: string }}
 */
export function pickPair(seed) {
  const { next } = createRandom(`${seed}:pair`);
  const index = Math.floor(next() * PAIRS.length) % PAIRS.length;
  const pair = PAIRS[index];
  return { ...pair, id: pair.symbol.replace("/", "") };
}

/* ==========================================================================
   4. 行情序列生成
   ========================================================================== */

const round = (value) => Number(value.toFixed(MODEL.PRICE_DECIMALS));

/**
 * 生成一整个回合的 K 线序列（含玩家一开始看不到的未来部分）。
 *
 * @param {object} options
 * @param {string} options.seed            随机种子
 * @param {typeof PAIRS[number]} options.pair 货币对
 * @param {keyof typeof DIFFICULTIES} options.difficultyId 难度
 * @param {number} options.historyCount    初始历史根数（默认 30）
 * @param {number} options.revealCount     开仓后要揭示的根数
 * @returns {{ candles: Array, pair: object, seed: string, difficultyId: string, historyCount: number }}
 */
export function generateSeries({
  seed,
  pair,
  difficultyId,
  historyCount = GAME.historyCandles,
  revealCount = revealCountFor(difficultyId),
}) {
  const difficulty = DIFFICULTIES[difficultyId];
  if (!difficulty) throw new Error(`未知难度：${difficultyId}`);

  const sigma = sigmaFor(difficulty.volatility);
  const trendP = difficulty.trend / 100;
  const shockP = difficulty.shockProb / 100;

  const total = historyCount + revealCount;
  const { next, gauss } = createRandom(`${seed}:${pair.id}:${difficultyId}`);

  const candles = [];
  let prevClose = pair.basePrice;
  let prevDir = next() < 0.5 ? -1 : 1; // 第一根之前的“趋势方向”随机定

  for (let i = 0; i < total; i++) {
    const open = prevClose;
    const unit = open * sigma; // 本根 K 线的 1σ 绝对值

    // ① 基础随机波动
    let body = gauss() * unit;

    // ② 趋势持续性：以 trend% 的概率让本根延续上一根的方向
    if (next() < trendP) {
      body = Math.abs(body) * prevDir;
    }

    // ③ 突发事件：小概率出现一次明显冲击（方向随机）
    if (next() < shockP) {
      const magnitude = MODEL.SHOCK_MIN + next() * (MODEL.SHOCK_MAX - MODEL.SHOCK_MIN);
      body += (next() < 0.5 ? -1 : 1) * magnitude * unit;
    }

    const close = open + body;
    const wick = Math.abs(gauss()) * unit * MODEL.WICK_RATIO;

    // ④ 影线：上下影线在实体之外随机延伸
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick * (0.55 + next() * 0.9);

    const candle = {
      time: MODEL.TIME_ORIGIN + i * GAME.candleSeconds,
      open: round(open),
      high: round(Math.max(high, open, close)),
      low: round(Math.min(low, open, close)),
      close: round(close),
    };
    candles.push(candle);

    prevDir = candle.close >= candle.open ? 1 : -1;
    prevClose = candle.close;
  }

  return {
    seed,
    pair,
    difficultyId,
    historyCount,
    candles,
  };
}

/** 一回合新 K 线的根数：60 秒 ÷ 每根间隔（普通 15 / 困难 30 / 极限 60） */
export function revealCountFor(difficultyId) {
  const difficulty = DIFFICULTIES[difficultyId];
  return Math.floor((GAME.roundSeconds * 1000) / difficulty.candleIntervalMs);
}
