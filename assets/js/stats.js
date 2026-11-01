/**
 * stats.js — 对局统计（纯函数，无 DOM）
 *
 * 输入是一局里每回合的结算记录，输出文档 §8.6 要求的全部成绩数据：
 *   初始资金、最终资金、累计盈亏、总回合数、盈利回合、亏损回合、胜率、
 *   单轮最大盈利、单轮最大亏损、最大连续盈利次数、最大连续亏损次数
 *
 * 统计只用于成绩展示，不构成成就系统（文档 §8.6 末尾）。
 */

/**
 * @param {Array<{pnl:number}>} records 每回合记录，按时间顺序
 * @param {{initialBalance:number, finalBalance:number}} options
 */
export function computeStats(records, { initialBalance, finalBalance }) {
  const list = Array.isArray(records) ? records : [];

  let wins = 0;
  let losses = 0;
  let flats = 0;
  let best = null;
  let worst = null;
  let bestRound = null;
  let worstRound = null;

  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  list.forEach((record, index) => {
    const pnl = Number(record.pnl) || 0;

    if (pnl > 0) {
      wins += 1;
      winStreak += 1;
      lossStreak = 0;
      if (winStreak > maxWinStreak) maxWinStreak = winStreak;
    } else if (pnl < 0) {
      losses += 1;
      lossStreak += 1;
      winStreak = 0;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    } else {
      // 不盈不亏：不打断"连续"统计，但也不计入胜/负
      flats += 1;
    }

    if (best === null || pnl > best) {
      best = pnl;
      bestRound = index + 1;
    }
    if (worst === null || pnl < worst) {
      worst = pnl;
      worstRound = index + 1;
    }
  });

  const rounds = list.length;
  const totalPnl = list.reduce((sum, record) => sum + (Number(record.pnl) || 0), 0);
  const winRate = rounds > 0 ? (wins / rounds) * 100 : 0;

  return {
    initialBalance,
    finalBalance,
    totalPnl: round2(totalPnl),
    returnRate: initialBalance > 0 ? (totalPnl / initialBalance) * 100 : 0,
    rounds,
    wins,
    losses,
    flats,
    winRate,
    best: best ?? 0,
    worst: worst ?? 0,
    bestRound,
    worstRound,
    maxWinStreak,
    maxLossStreak,
  };
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
