/**
 * session.js — 一局游戏的状态（纯逻辑，无 DOM）
 *
 * 一局 = 固定 5 回合（用户设定），难度整局锁定。
 * 每回合结束记一条 record；5 回合打完、或资金不足以开最低仓位时结束本局。
 *
 * 结束条件（用户确认"最低可交易余额 = 0"）：
 *   余额 ≤ 0，或连"余额 5%"的最低保证金都算不出正数（余额极小时四舍五入到 0.00）
 *   —— 不额外设 50/100 这类人为下限。
 */

import { GAME } from "./config.js";
import { createAccount } from "./account.js";
import { marginFor } from "./trading.js";
import { computeStats } from "./stats.js";

/** 一局固定回合数 */
export const ROUNDS_PER_GAME = 5;

let game = null;

/**
 * 开一局新游戏。
 * @param {{difficultyId: string, initialBalance?: number}} options
 */
export function startGame({ difficultyId, initialBalance = GAME.initialBalance }) {
  game = {
    difficultyId,
    totalRounds: ROUNDS_PER_GAME,
    currentRound: 1,
    initialBalance,
    account: createAccount(initialBalance),
    records: [],
    finished: false,
    finishReason: null, // 'rounds'（打满 5 回合）| 'broke'（资金不足）
    startedAt: Date.now(),
  };
  return game;
}

export function getGame() {
  return game;
}

export function getAccount() {
  return game?.account ?? null;
}

export function isGameActive() {
  return Boolean(game) && !game.finished;
}

/** 当前是第几回合（1 起） */
export function currentRoundNumber() {
  return game ? game.currentRound : 0;
}

export function totalRounds() {
  return game ? game.totalRounds : ROUNDS_PER_GAME;
}

/**
 * 记一回合的结算。
 * @param {object} record
 */
export function addRoundRecord(record) {
  if (!game) return 0;
  game.records.push(record);
  return game.records.length;
}

export function getRecords() {
  return game ? [...game.records] : [];
}

/**
 * 还能不能开下一回合（文档 §7.2 + 用户设定"最低可交易余额 0"）。
 * @returns {boolean}
 */
export function canContinue() {
  if (!game) return false;
  const { balance } = game.account;
  if (!(balance > 0)) return false;
  const minMargin = marginFor(balance, GAME.marginRatio.min * 100);
  return minMargin >= 0.01; // 连 1 分钱保证金都开不出来就没法玩了
}

/**
 * 本回合之后是否已经打满一局。
 */
export function isLastRound() {
  return Boolean(game) && game.currentRound >= game.totalRounds;
}

/** 进入下一回合（调用前应确认 isLastRound() 为 false 且 canContinue()） */
export function advanceRound() {
  if (!game) return false;
  if (game.currentRound >= game.totalRounds) return false;
  game.currentRound += 1;
  return true;
}

/**
 * 结束本局。
 * @param {'rounds'|'broke'} reason
 */
export function finishGame(reason) {
  if (!game) return null;
  game.finished = true;
  game.finishReason = reason;
  return game;
}

/** 本局统计（文档 §8.6） */
export function getStats() {
  if (!game) return computeStats([], { initialBalance: 0, finalBalance: 0 });
  return computeStats(game.records, {
    initialBalance: game.initialBalance,
    finalBalance: game.account.balance,
  });
}

/** 清空当前对局（回首页/重新开局时用） */
export function resetGame() {
  game = null;
}
