/**
 * tools/stats-selftest.mjs — 对局与统计自检（阶段五验收用）
 *
 * 覆盖：
 *   1. 文档 §8.6 的各项成绩统计（胜率、最大单轮盈亏、最大连胜/连败）
 *   2. 一局固定 5 回合的推进与结束判定
 *   3. "最低可交易余额 = 0" 的结束条件（余额 ≤ 0 或连最低保证金都开不出）
 *
 * 运行：node tools/stats-selftest.mjs
 */

import { GAME } from "../assets/js/config.js";
import { computeStats } from "../assets/js/stats.js";
import * as session from "../assets/js/session.js";

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

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

/* -------------------------------------------------------------------------- */
console.log("\n【1】成绩统计（文档 §8.6）");
/* -------------------------------------------------------------------------- */

{
  const records = [
    { pnl: 100 }, // 1 胜
    { pnl: 250 }, // 2 胜（连胜 2）
    { pnl: -80 }, // 1 负
    { pnl: -120 }, // 2 负（连败 2）
    { pnl: 0 }, // 不盈不亏
    { pnl: 400 }, // 3 胜（连胜 1，因为中间有 0）
    { pnl: -50 }, // 1 负
    { pnl: -200 }, // 2 负
    { pnl: -10 }, // 3 负（连败 3）
  ];
  const stats = computeStats(records, { initialBalance: 10000, finalBalance: 10290 });

  check("总回合数 = 9", stats.rounds === 9, String(stats.rounds));
  check("盈利回合 = 3", stats.wins === 3, String(stats.wins));
  check("亏损回合 = 5", stats.losses === 5, String(stats.losses));
  check("不盈不亏回合 = 1", stats.flats === 1, String(stats.flats));
  check("胜率 = 3/9 = 33.3%", near(stats.winRate, 33.333, 0.01), stats.winRate.toFixed(2));
  check("单轮最大盈利 = 400（第 6 轮）", stats.best === 400 && stats.bestRound === 6);
  check("单轮最大亏损 = −200（第 8 轮）", stats.worst === -200 && stats.worstRound === 8);
  check("最大连续盈利 = 2", stats.maxWinStreak === 2, String(stats.maxWinStreak));
  check("最大连续亏损 = 3", stats.maxLossStreak === 3, String(stats.maxLossStreak));
  check("累计盈亏 = 290", near(stats.totalPnl, 290), String(stats.totalPnl));

  const empty = computeStats([], { initialBalance: 10000, finalBalance: 10000 });
  check("空记录不会崩：回合 0、胜率 0", empty.rounds === 0 && empty.winRate === 0);
  check("空记录的单轮最大盈亏都是 0", empty.best === 0 && empty.worst === 0);
}

/* -------------------------------------------------------------------------- */
console.log("\n【2】一局 5 回合的推进");
/* -------------------------------------------------------------------------- */

{
  check("一局固定 5 回合", session.ROUNDS_PER_GAME === 5);

  const game = session.startGame({ difficultyId: "hard" });
  check("开局：第 1 回合", session.currentRoundNumber() === 1);
  check("开局：账户余额 = 10,000", session.getAccount().balance === GAME.initialBalance);
  check("开局：没有记录、未结束", session.getRecords().length === 0 && !game.finished);
  check("开局：还有下一回合", !session.isLastRound());

  session.addRoundRecord({ pnl: 100 });
  check("记录 1 条后统计回合数 = 1", session.getStats().rounds === 1);

  // 推进到第 5 回合
  for (let i = 0; i < 4; i++) session.advanceRound();
  check("推进 4 次后到第 5 回合", session.currentRoundNumber() === 5);
  check("第 5 回合是最后一回合", session.isLastRound());
  check("最后一回合再推进无效", session.advanceRound() === false);

  session.finishGame("rounds");
  check("结束后 finished = true 且原因是 rounds", game.finished && game.finishReason === "rounds");
  check("结束后 isGameActive 为 false", !session.isGameActive());

  session.resetGame();
  check("resetGame 清空对局", session.getGame() === null);
}

/* -------------------------------------------------------------------------- */
console.log("\n【3】资金不足的结束判定（最低可交易余额 = 0）");
/* -------------------------------------------------------------------------- */

{
  session.startGame({ difficultyId: "normal" });
  const account = session.getAccount();

  account.balance = 10000;
  check("余额 10,000 时可以继续", session.canContinue() === true);

  account.balance = 100;
  check("余额 100 时可以继续（5% = 5 USD 的最低保证金）", session.canContinue() === true);

  account.balance = 0.2;
  check("余额 0.20 仍可继续（5% = 0.01 USD）", session.canContinue() === true);

  account.balance = 0.05;
  check("余额 0.05 时 5% 不足 1 分钱，判定无法继续", session.canContinue() === false);

  account.balance = 0;
  check("余额为 0 时无法继续", session.canContinue() === false);

  account.balance = -5;
  check("余额为负时无法继续", session.canContinue() === false);

  session.resetGame();
}

/* -------------------------------------------------------------------------- */
console.log(
  `\n结果：${checks - failures} / ${checks} 项通过${failures ? `，${failures} 项失败` : ""}\n`
);
process.exit(failures ? 1 : 0);
