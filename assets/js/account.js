/**
 * account.js — 资金账务（纯函数，无 DOM）
 *
 * 采用「余额 + 冻结额」模型，保证不管开仓、平仓多少次都不会重复记账（文档 §5.2）：
 *
 *   balance（账户余额）  已结算的资金总额，**包含**当前被冻结的保证金
 *   frozen（当前保证金） 开仓时从可用资金里冻结的金额（阶段四会加上追加部分）
 *   available（可用资金）= balance − frozen
 *   equity（总权益）    = balance + 浮动盈亏
 *
 * 开仓：balance 不变，frozen += M0        → 可用资金减少 M0
 * 平仓：frozen −= M0，balance += 已实现盈亏 → 保证金"释放"，盈亏只记一次
 *
 * 之所以冻结不真的从 balance 里扣钱，是因为扣了之后平仓再"加回来"极容易写重复；
 * 用两个独立的数做加减，天然不会重复。
 */

import { GAME } from "./config.js";
import { round2 } from "./trading.js";

/**
 * 创建一个账户。
 * @param {number} balance 初始余额（默认 10,000 USD）
 */
export function createAccount(balance = GAME.initialBalance) {
  return {
    balance: round2(balance), // 账户余额（含冻结部分）
    frozen: 0, // 当前累计保证金
    realized: 0, // 累计已实现盈亏
    trades: 0, // 已平仓回合数（阶段五统计会用到）
  };
}

/** 可用资金 = 余额 − 当前保证金 */
export function availableOf(account) {
  return round2(account.balance - account.frozen);
}

/** 账户总权益 = 余额 + 浮动盈亏 */
export function equityOf(account, floatingPnl = 0) {
  return round2(account.balance + floatingPnl);
}

/**
 * 冻结保证金。资金不足时返回 false，不改动账户。
 * @returns {boolean}
 */
export function freezeMargin(account, amount) {
  const value = round2(amount);
  if (!(value > 0)) return false;
  if (value > availableOf(account) + 1e-6) return false;
  account.frozen = round2(account.frozen + value);
  return true;
}

/**
 * 释放保证金（平仓时调用）。最多释放账户里实际冻结的金额，防止负数。
 * @returns {number} 实际释放的金额
 */
export function releaseMargin(account, amount) {
  const value = Math.min(round2(amount), account.frozen);
  account.frozen = round2(account.frozen - value);
  return value;
}

/**
 * 记入已实现盈亏（平仓时调用一次）。
 * @returns {number} 新的账户余额
 */
export function applyRealized(account, pnl) {
  account.balance = round2(account.balance + pnl);
  account.realized = round2(account.realized + pnl);
  return account.balance;
}

/**
 * 结算一次平仓：先释放保证金，再记入盈亏（顺序无关，但集中在一处便于审查）。
 * @param {object} account
 * @param {{margin:number, pnl:number}} result
 */
export function settleTrade(account, { margin, pnl }) {
  const released = releaseMargin(account, margin);
  const balance = applyRealized(account, pnl);
  account.trades += 1;
  return { released, balance, pnl };
}
