/**
 * trading.js — 交易计算（纯函数，无 DOM）
 *
 * 严格按需求文档 §5.1 的公式：
 *   名义仓位  N = 初始保证金 M0 × 杠杆 L
 *   浮动盈亏  P = N × ((Pc − Po) / Po) × D      D = 做多 +1 / 做空 −1
 *
 * 因为 N = M0 × L，所以「盈亏 / 保证金 = L × 涨跌幅」，
 * 这条关系是阶段四强平阈值（90% / L）的数学基础，测试里也用它交叉验证。
 *
 * 追加保证金不会改变 N（文档 §6.3），所以 position.notional 在开仓时定死。
 */

import { GAME } from "./config.js";

/** 金额统一保留 2 位小数（比较时用 EPS 容差） */
export const MONEY_EPS = 1e-6;

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 方向系数：做多 +1，做空 −1 */
export function directionOf(side) {
  return side === "short" ? -1 : 1;
}

/** 保证金金额 = 账户余额 × 投入比例（文档 §4.4） */
export function marginFor(balance, ratioPercent) {
  return round2((balance * ratioPercent) / 100);
}

/** 名义仓位 = 保证金 × 杠杆 */
export function notionalFor(margin, leverage) {
  return round2(margin * leverage);
}

/**
 * 创建持仓快照（开仓时确定方向、杠杆、名义仓位，之后都不再改动）。
 *
 * 注意两个保证金字段的区别（文档 §6.3）：
 *   initialMargin 开仓时的保证金 M0 —— 名义仓位 N = M0 × L 由它决定，永远不变
 *   margin        当前累计保证金 M = M0 + 追加金额之和 —— 追加时只改这个
 *
 * @param {{side:'long'|'short', leverage:number, margin:number, entryPrice:number}} options
 */
export function createPosition({ side, leverage, margin, entryPrice }) {
  const dir = directionOf(side);
  return {
    side,
    dir,
    leverage,
    initialMargin: round2(margin),
    margin: round2(margin),
    notional: notionalFor(margin, leverage),
    entryPrice,
  };
}

/**
 * 追加保证金：只增加累计保证金，不改变方向、开仓价、杠杆和名义仓位（文档 §6.3）。
 * @returns {number} 追加后的累计保证金
 */
export function addMarginToPosition(position, amount) {
  const value = round2(amount);
  if (!(value > 0)) return position.margin;
  position.margin = round2(position.margin + value);
  return position.margin;
}

/** 当前保证金的强平阈值（亏损金额）：累计保证金 × 90%（文档 §6.1） */
export function liquidationLossFor(position) {
  if (!position) return 0;
  return round2(position.margin * GAME.liquidationRatio);
}

/**
 * 强平价：价格走到这里时，浮动亏损恰好等于累计保证金的 90%。
 *
 *   亏损 = N × |ΔP| / Po = 0.9 × M
 *   →  |ΔP| / Po = 0.9 × M / N
 *
 * 因为名义仓位 N 在开仓时已固定，追加保证金只会把强平价推得更远，
 * 所以追加后仓位更难被强平 —— 这正是文档 §6.3 想要的效果。
 */
export function stopPriceFor(position) {
  if (!position || !(position.notional > 0)) return NaN;
  const distance = (GAME.liquidationRatio * position.margin) / position.notional;
  return position.entryPrice * (1 - position.dir * distance);
}

/**
 * 强平触发时是否还要弹窗询问（文档 §6.4）。
 * 剩余时间太短就来不及追加，直接按强平价结算更合理。
 * @param {number} remainingMs 剩余交易时间（毫秒）
 */
export function shouldShowLiquidationDialog(remainingMs) {
  return remainingMs >= GAME.liquidationDialogMinMs;
}

/**
 * 判断某个价格是否已经触及强平价（文档 §6.5：单根跳动越过也要识别）。
 *
 * 用**收盘价**判定，与"开仓/平仓都按当时的价格成交"保持一致：
 *   K 线只是短暂插针、收盘又回到阈值上方时不算强平（那笔成交根本不会发生）；
 *   收盘已经越过的，按强平价成交（不低于阈值，绝不穿仓）。
 *
 * @param {object} position
 * @param {number} price 当前价（通常取最新一根 K 线的收盘价）
 */
export function isLiquidatedAt(position, price) {
  const stop = stopPriceFor(position);
  if (!Number.isFinite(stop) || !Number.isFinite(price)) return false;
  return position.dir === 1 ? price <= stop : price >= stop;
}

/** 浮动盈亏（文档 §5.1） */
export function pnlAt(position, price) {
  if (!position || !Number.isFinite(price) || !(position.entryPrice > 0)) return 0;
  const move = (price - position.entryPrice) / position.entryPrice;
  return position.notional * move * position.dir;
}

/** 浮动盈亏相对保证金的百分比（用于展示，不参与记账） */
export function pnlRatioAt(position, price) {
  if (!position || !(position.margin > 0)) return 0;
  return (pnlAt(position, price) / position.margin) * 100;
}

/** 杠杆档位是否合法 */
export function isValidLeverage(leverage) {
  return GAME.leverageOptions.includes(leverage);
}

/** 把任意比例值吸附到滑块步长上（并限制在允许区间） */
export function snapRatio(ratioPercent) {
  const { min, max, step } = GAME.marginRatio;
  const minPercent = min * 100;
  const maxPercent = max * 100;
  const stepPercent = step * 100;
  const clamped = Math.min(maxPercent, Math.max(minPercent, ratioPercent));
  return Math.round(clamped / stepPercent) * stepPercent;
}

/**
 * 开仓前校验（文档 §4.4 / §7.2）。
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateOpen({ side, leverage, ratioPercent, balance, available }) {
  if (side !== "long" && side !== "short") {
    return { ok: false, reason: "请先选择做多或做空" };
  }
  if (!isValidLeverage(leverage)) {
    return { ok: false, reason: "杠杆档位无效" };
  }
  const margin = marginFor(balance, ratioPercent);
  if (!(margin > 0)) {
    return { ok: false, reason: "保证金不足" };
  }
  if (margin > available + MONEY_EPS) {
    return { ok: false, reason: "可用资金不足" };
  }
  return { ok: true, margin };
}
