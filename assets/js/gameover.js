/**
 * gameover.js — 一局结束页（文档 §8.6 的全部成绩项）
 *
 * 一局固定 5 回合（用户设定）：打满 5 回合，或资金不足以开下一笔最低仓位时结束。
 * 这些数据只用于成绩展示，不构成成就系统。
 */

import { COPY } from "./copy.js";
import { go, fmtMoney, fmtSignedMoney, fmtSignedPercent, setSignClass } from "./ui.js";
import * as session from "./session.js";

function el(key) {
  return document.querySelector(`[data-gameover="${key}"]`);
}

/** 进入结束页时刷新内容（由 app.js 在 onScreenEnter 时调用） */
export function renderGameover() {
  const game = session.getGame();
  if (!game) {
    go("home");
    return;
  }

  const stats = session.getStats();
  const broke = game.finishReason === "broke";

  const reason = el("reason");
  if (reason) {
    reason.textContent = broke ? COPY.gameoverReasonBroke : COPY.gameoverReasonRounds;
  }

  const amount = el("amount");
  if (amount) {
    amount.textContent = `${fmtSignedMoney(stats.totalPnl)} USD`;
    setSignClass(amount, stats.totalPnl);
  }

  const sub = el("sub");
  if (sub) {
    sub.textContent = `初始 ${fmtMoney(stats.initialBalance)} → 最终 ${fmtMoney(
      stats.finalBalance
    )}（${fmtSignedPercent(stats.returnRate)}）`;
  }

  const set = (key, text) => {
    const node = el(key);
    if (node) node.textContent = text;
  };

  set("initialBalance", `${fmtMoney(stats.initialBalance)} USD`);
  set("finalBalance", `${fmtMoney(stats.finalBalance)} USD`);

  const totalPnl = el("totalPnl");
  if (totalPnl) {
    totalPnl.textContent = `${fmtSignedMoney(stats.totalPnl)} USD`;
    setSignClass(totalPnl, stats.totalPnl);
  }

  set("rounds", `${stats.rounds} / ${game.totalRounds}`);
  set("wins", String(stats.wins));
  set("losses", String(stats.losses));
  set("winRate", `${stats.winRate.toFixed(1)}%`);

  const best = el("best");
  if (best) {
    best.textContent = `${fmtSignedMoney(stats.best)} USD`;
    setSignClass(best, stats.best);
  }
  const worst = el("worst");
  if (worst) {
    worst.textContent = `${fmtSignedMoney(stats.worst)} USD`;
    setSignClass(worst, stats.worst);
  }

  set("maxWinStreak", `${stats.maxWinStreak} 次`);
  set("maxLossStreak", `${stats.maxLossStreak} 次`);
}

export function initGameover() {
  const screen = document.querySelector('[data-screen="gameover"]');
  if (!screen) return;

  screen.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-gameover-action]");
    if (!btn) return;

    if (btn.dataset.gameoverAction === "again") {
      session.resetGame();
      go("difficulty");
    } else if (btn.dataset.gameoverAction === "home") {
      session.resetGame();
      go("home");
    }
  });
}
