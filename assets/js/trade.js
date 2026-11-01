/**
 * trade.js — 交易主界面（阶段五：接入"一局 5 回合"的对局结构）
 *
 * 状态机：
 *   ready    未开仓：30 根历史 K 线静止，可调方向 / 杠杆 / 保证金比例
 *   open     持仓中：60 秒倒计时 + 行情逐根揭示 + 浮动盈亏实时更新
 *   settled  已平仓：把结果交给对局模块，跳到结算页或结束页
 *
 * 计时与暂停：
 *   elapsed = 已累计的有效毫秒 + (运行中 ? now − 起点 : 0)
 *   强平弹窗、平仓确认期间时间不流逝、行情不推进。
 *
 * 强平（文档 §6）：
 *   触发：收盘价越过强平价（浮动亏损 ≥ 累计保证金 90%）
 *   成交：按强平价成交，亏损恰为 90% 累计保证金，不穿仓
 *   剩余 < 5 秒：不弹窗，直接结算
 *
 * 本文件只管"一回合"；一局（5 回合、账户、成绩）在 session.js。
 */

import { GAME, DIFFICULTIES } from "./config.js";
import { COPY, LABELS } from "./copy.js";
import {
  go,
  toast,
  onScreenEnter,
  onScreenLeave,
  currentScreenName,
  fmtPrice,
  fmtMoney,
  fmtSignedMoney,
  fmtSignedPercent,
  setSignClass,
  copyText,
} from "./ui.js";
import { createChartView, isChartAvailable } from "./chart.js";
import { generateSeries, pickPair, createSeed, normalizeSeed, revealCountFor } from "./market.js";
import {
  createPosition,
  addMarginToPosition,
  pnlAt,
  pnlRatioAt,
  marginFor,
  validateOpen,
  snapRatio,
  stopPriceFor,
  liquidationLossFor,
  isLiquidatedAt,
  shouldShowLiquidationDialog,
  round2,
} from "./trading.js";
import { availableOf, equityOf, freezeMargin, settleTrade } from "./account.js";
import * as session from "./session.js";
import * as storage from "./storage.js";

/* ==========================================================================
   1. 状态
   ========================================================================== */

const TICK_MS = 100;
const ROUND_MS = GAME.roundSeconds * 1000;
/** 强平价离现价超过这个比例时，不强行拉价格轴，改用图内角标提示 */
const STOP_LINE_MAX_DISTANCE = 0.02;

/** 下单表单（未开仓时有效） */
const form = {
  side: null,
  leverage: 10,
  ratioPercent: snapRatio(50),
};

let round = null;
let phase = "ready"; // ready | open | settled
let position = null;

let view = null;
let entryLine = null;
let stopLine = null;

let tickId = null;
let elapsedBase = 0;
let runningSince = 0;

let liqAmount = 0;
let stopOutOfView = false;

const el = {};

const liquidateDialog = document.getElementById("liquidate-dialog");
const confirmDialog = document.getElementById("confirm-dialog");
const abandonDialog = document.getElementById("abandon-dialog");

/** 当前对局账户（由 session 持有，一局结束重开时会换成新账户） */
function acc() {
  return session.getAccount();
}

/* ==========================================================================
   2. DOM 缓存
   ========================================================================== */

function q(scope, key) {
  return scope?.querySelector(`[data-trade="${key}"]`) ?? null;
}

function cacheEls() {
  const root = document.querySelector('[data-screen="trade"]');
  if (!root) return;
  const orderPanel = root.querySelector(".panel--order");

  el.root = root;
  el.symbol = q(root, "symbol");
  el.pairName = q(root, "pairName");
  el.price = q(root, "price");
  el.change = q(root, "change");
  el.difficulty = q(root, "difficulty");
  el.seed = q(root, "seed");
  el.round = q(root, "round");
  el.timerBox = q(root, "timerBox");
  el.timer = q(root, "timer");

  // 账户金额都搬到了右下角状态条里
  el.balance = q(root, "balance");
  el.available = q(root, "available");
  el.marginUsed = q(root, "marginUsed");
  el.equity = q(root, "equity");
  el.realized = q(root, "realized");

  el.entryPrice = q(root, "entryPrice");
  el.currentPrice = q(root, "currentPrice");
  el.footStop = q(root, "footStop");
  el.footNotional = q(root, "footNotional");
  el.floating = q(root, "floating");
  el.footPnl = q(root, "footPnl");

  el.openBtn = q(root, "open");
  el.closeBtn = q(root, "close");
  el.revealFill = q(root, "revealFill");
  el.stopBadge = q(root, "stopBadge");
  el.chartContainer = document.getElementById("trade-chart");

  el.orderPanel = orderPanel;
  el.ratioValue = q(orderPanel, "ratioValue");
  el.marginAmount = q(orderPanel, "marginAmount");
  el.notional = q(orderPanel, "notional");
  el.range = document.getElementById("margin-range");
  el.leverageChips = document.getElementById("leverage-chips");
  el.sideButtons = [...(orderPanel?.querySelectorAll("[data-side]") || [])];

  const liq = (key) => liquidateDialog?.querySelector(`[data-liq="${key}"]`);
  el.liq = {
    loss: liq("loss"),
    cumMargin: liq("cumMargin"),
    stopLoss: liq("stopLoss"),
    stopPrice: liq("stopPrice"),
    available: liq("available"),
    amount: liq("amount"),
    afterMargin: liq("afterMargin"),
    afterStopLoss: liq("afterStopLoss"),
    afterStopPrice: liq("afterStopPrice"),
    fillLoss: liq("fillLoss"),
    noFunds: liq("noFunds"),
    range: document.getElementById("liquidate-range"),
    addBtn: liquidateDialog?.querySelector('[data-liq-action="add"]'),
    quickBtns: [...(liquidateDialog?.querySelectorAll("[data-liq-quick]") || [])],
  };

  const cf = (key) => confirmDialog?.querySelector(`[data-confirm="${key}"]`);
  el.confirm = {
    side: cf("side"),
    leverage: cf("leverage"),
    entryPrice: cf("entryPrice"),
    currentPrice: cf("currentPrice"),
    floating: cf("floating"),
  };
}

/* ==========================================================================
   3. 工具
   ========================================================================== */

function currentPrice() {
  if (!round) return NaN;
  const candles = round.candles.slice(0, round.shown);
  return candles.length ? candles[candles.length - 1].close : NaN;
}

function toChartCandle(candle) {
  return {
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function sideText(side) {
  return side === "short"
    ? COPY.shortLabel.replace(/[▼▲]\s*$/, "").trim()
    : COPY.longLabel.replace(/[▼▲]\s*$/, "").trim();
}

/* ---- 计时（支持暂停） ---- */

function elapsedNow() {
  return elapsedBase + (runningSince ? Date.now() - runningSince : 0);
}

function remainingNow() {
  return Math.max(0, ROUND_MS - elapsedNow());
}

function resetClock() {
  elapsedBase = 0;
  runningSince = 0;
  stopTick();
}

function pauseClock() {
  if (!runningSince) return;
  elapsedBase += Date.now() - runningSince;
  runningSince = 0;
  stopTick();
}

function resumeClock() {
  if (runningSince) return;
  runningSince = Date.now();
  startTick();
}

/* ==========================================================================
   4. 渲染
   ========================================================================== */

function renderHeader() {
  if (!round) return;
  if (el.symbol) el.symbol.textContent = round.pair.symbol;
  if (el.pairName) el.pairName.textContent = round.pair.name;
  if (el.difficulty) el.difficulty.textContent = round.difficulty.name;
  if (el.seed) el.seed.textContent = round.seed;
  if (el.round) {
    el.round.textContent = `第 ${session.currentRoundNumber()} / ${session.totalRounds()} 回合`;
  }

  const price = currentPrice();
  if (el.price) el.price.textContent = fmtPrice(price);

  const first = round.candles[0];
  const pct = first ? ((price - first.open) / first.open) * 100 : 0;
  if (el.change) {
    el.change.textContent = fmtSignedPercent(pct);
    setSignClass(el.change, pct);
  }
}

function renderAccount() {
  const account = acc();
  if (!account) return;

  const price = currentPrice();
  const floating = position ? pnlAt(position, price) : 0;
  const ratio = position ? pnlRatioAt(position, price) : 0;

  if (el.balance) el.balance.textContent = fmtMoney(account.balance);
  if (el.available) el.available.textContent = fmtMoney(availableOf(account));
  if (el.marginUsed) el.marginUsed.textContent = fmtMoney(account.frozen);
  if (el.equity) el.equity.textContent = fmtMoney(equityOf(account, floating));
  if (el.realized) {
    el.realized.textContent = fmtSignedMoney(account.realized);
    setSignClass(el.realized, account.realized);
  }

  // 开仓按钮下方的浮动盈亏：金额 + 百分比，颜色与符号一起表达盈亏
  const pnlText = position ? `${fmtSignedMoney(floating)} (${fmtSignedPercent(ratio)})` : "—";
  if (el.floating) {
    el.floating.textContent = pnlText;
    setSignClass(el.floating, position ? floating : 0);
  }
  // 底部状态条里也放一份（方便看挂单状态时不往右瞄）
  if (el.footPnl) {
    el.footPnl.textContent = pnlText;
    setSignClass(el.footPnl, position ? floating : 0);
  }
}

function renderForm() {
  const account = acc();
  if (!account) return;

  el.sideButtons.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.side === form.side));
  });

  if (el.leverageChips) {
    [...el.leverageChips.children].forEach((btn) => {
      const active = Number(btn.dataset.leverage) === form.leverage;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  const margin = marginFor(account.balance, form.ratioPercent);
  if (el.range && Number(el.range.value) !== form.ratioPercent) {
    el.range.value = String(form.ratioPercent);
  }
  if (el.range) {
    const minPct = GAME.marginRatio.min * 100;
    const maxPct = GAME.marginRatio.max * 100;
    const fill = ((form.ratioPercent - minPct) / (maxPct - minPct)) * 100;
    el.range.style.setProperty("--fill", `${fill.toFixed(1)}%`);
  }
  if (el.ratioValue) el.ratioValue.textContent = `${form.ratioPercent}%`;
  if (el.marginAmount) el.marginAmount.textContent = fmtMoney(margin);
  if (el.notional) el.notional.textContent = fmtMoney(margin * form.leverage);

  if (el.openBtn) {
    const check = validateOpen({
      side: form.side,
      leverage: form.leverage,
      ratioPercent: form.ratioPercent,
      balance: account.balance,
      available: availableOf(account),
    });
    el.openBtn.disabled = phase !== "ready" || !check.ok;
    el.openBtn.title = phase === "ready" && !check.ok ? check.reason : "";
  }
}

function renderPosition() {
  const price = currentPrice();
  if (el.currentPrice) el.currentPrice.textContent = fmtPrice(price);

  if (!position) {
    if (el.entryPrice) el.entryPrice.textContent = "—";
    if (el.footStop) el.footStop.textContent = "—";
    if (el.footNotional) el.footNotional.textContent = "—";
    if (el.closeBtn) el.closeBtn.disabled = true;
    return;
  }

  if (el.entryPrice) el.entryPrice.textContent = fmtPrice(position.entryPrice);
  if (el.footStop) el.footStop.textContent = fmtPrice(stopPriceFor(position));
  if (el.footNotional) el.footNotional.textContent = fmtMoney(position.notional);
  if (el.closeBtn) el.closeBtn.disabled = phase !== "open";
}

function renderTimer() {
  if (!el.timerBox || !el.timer) return;
  const remaining = phase === "open" ? remainingNow() : phase === "settled" ? 0 : ROUND_MS;
  const seconds = remaining / 1000;
  el.timer.textContent = seconds.toFixed(1);
  el.timerBox.classList.toggle("is-idle", phase !== "open");
  el.timerBox.classList.toggle("is-urgent", phase === "open" && seconds <= 10);
}

function renderReveal() {
  if (!round || !el.revealFill) return;
  const totalReveal = round.candles.length - round.historyCount;
  const revealed = Math.max(0, round.shown - round.historyCount);
  const percent = totalReveal > 0 ? (revealed / totalReveal) * 100 : 0;
  el.revealFill.style.width = `${percent.toFixed(1)}%`;
}

function renderAll() {
  renderHeader();
  renderAccount();
  renderForm();
  renderPosition();
  renderReveal();
  renderTimer();
  renderStopBadge();
}

function lockControls(locked) {
  el.sideButtons.forEach((btn) => (btn.disabled = locked));
  if (el.leverageChips) {
    [...el.leverageChips.children].forEach((btn) => (btn.disabled = locked));
  }
  if (el.range) el.range.disabled = locked;
}

/* ==========================================================================
   5. 图表
   ========================================================================== */

function ensureChart() {
  if (view || !el.chartContainer) return view;
  if (!isChartAvailable()) {
    toast("图表库未加载，请检查 vendor 目录。", 4000);
    return null;
  }
  view = createChartView(el.chartContainer);
  return view;
}

function drawChart() {
  const chartView = ensureChart();
  if (!chartView || !round) return;
  chartView.setData(round.candles.slice(0, round.shown).map(toChartCandle));
  chartView.fit();
}

function refreshPriceLines() {
  if (!view) return;
  if (entryLine) {
    view.removePriceLine(entryLine);
    entryLine = null;
  }
  if (stopLine) {
    view.removePriceLine(stopLine);
    stopLine = null;
  }
  if (!position) {
    view.setStopScale(null);
    renderStopBadge();
    return;
  }

  const stop = stopPriceFor(position);
  entryLine = view.addPriceLine(position.entryPrice, {
    color: "#a98fd6",
    lineStyle: 2,
    title: "开仓价",
  });
  stopLine = view.addPriceLine(stop, {
    color: "#e85d5b",
    lineWidth: 2,
    lineStyle: 0,
    title: "强平价",
  });

  const distance = Math.abs(position.entryPrice - stop) / position.entryPrice;
  stopOutOfView = distance > STOP_LINE_MAX_DISTANCE;
  view.setStopScale(stopOutOfView ? null : stop);
  renderStopBadge();
}

function renderStopBadge() {
  if (!el.stopBadge) return;
  if (!position || !stopOutOfView) {
    el.stopBadge.hidden = true;
    return;
  }
  const stop = stopPriceFor(position);
  const price = currentPrice();
  const away = ((stop - price) / price) * 100;
  el.stopBadge.hidden = false;
  el.stopBadge.textContent = `强平线 ${fmtPrice(stop)} · 距现价 ${fmtSignedPercent(away)}（在图外）`;
}

/* ==========================================================================
   6. 回合生命周期
   ========================================================================== */

/**
 * 开一个新回合并进入交易页。
 * 注意：对局（难度、回合数、账户）由 session 管理，这里只负责回合。
 */
export function startRound({ difficultyId, seed } = {}) {
  const difficulty = DIFFICULTIES[difficultyId];
  if (!difficulty) {
    toast("难度无效，请重新选择。");
    return;
  }

  const finalSeed = normalizeSeed(seed) || createSeed();
  const pair = pickPair(finalSeed);
  const data = generateSeries({
    seed: finalSeed,
    pair,
    difficultyId,
    historyCount: GAME.historyCandles,
    revealCount: revealCountFor(difficultyId),
  });

  resetClock();
  if (view) refreshPriceLines();

  round = {
    seed: finalSeed,
    difficultyId,
    difficulty,
    pair,
    candles: data.candles,
    historyCount: data.historyCount,
    shown: data.historyCount,
  };

  phase = "ready";
  position = null;
  lockControls(false);
  form.side = null;

  if (currentScreenName() === "trade") {
    drawChart();
    refreshPriceLines();
    renderAll();
  } else {
    go("trade");
  }
}

export function getState() {
  const account = acc();
  return {
    round,
    phase,
    position,
    account: account ? { ...account } : null,
    form: { ...form },
    paused: !runningSince,
    elapsedMs: elapsedNow(),
    remainingMs: remainingNow(),
    stopPrice: position ? stopPriceFor(position) : NaN,
    liquidationLoss: position ? liquidationLossFor(position) : 0,
    currentPrice: currentPrice(),
    priceLineCount: view ? view.priceLineCount() : 0,
    dialogs: {
      liquidate: Boolean(liquidateDialog?.open),
      confirm: Boolean(confirmDialog?.open),
      abandon: Boolean(abandonDialog?.open),
    },
    liqAmount,
    roundNumber: session.currentRoundNumber(),
    totalRounds: session.totalRounds(),
    chart: view ? view.debugState() : null,
  };
}

/* ==========================================================================
   7. 开仓 / 平仓
   ========================================================================== */

function openPosition() {
  if (phase !== "ready" || !round) return;
  const account = acc();
  if (!account) return;

  const check = validateOpen({
    side: form.side,
    leverage: form.leverage,
    ratioPercent: form.ratioPercent,
    balance: account.balance,
    available: availableOf(account),
  });
  if (!check.ok) {
    toast(check.reason, 2600);
    return;
  }

  const pos = createPosition({
    side: form.side,
    leverage: form.leverage,
    margin: check.margin,
    entryPrice: currentPrice(),
  });

  if (!freezeMargin(account, pos.margin)) {
    toast("可用资金不足，无法冻结保证金", 2600);
    return;
  }

  position = pos;
  phase = "open";
  resetClock();
  refreshPriceLines();
  lockControls(true);
  renderAll();
  resumeClock();

  toast(
    `已${pos.side === "long" ? "做多" : "做空"} ${round.pair.symbol} · ${pos.leverage}× · 保证金 ${fmtMoney(
      pos.margin
    )} USD`,
    2600
  );
}

/**
 * 平仓结算并交给对局流程。
 * @param {'manual'|'auto'|'liquidation'} reason
 * @param {number} [settlePrice] 强平时按强平价成交
 */
function closePosition(reason = "manual", settlePrice) {
  if (!position || !round || phase !== "open") return;
  const account = acc();
  if (!account) return;

  const price = Number.isFinite(settlePrice) ? settlePrice : currentPrice();
  const pnl = pnlAt(position, price);
  const settled = settleTrade(account, { margin: position.margin, pnl });

  stopTick();
  if (runningSince) {
    elapsedBase += Date.now() - runningSince;
    runningSince = 0;
  }
  phase = "settled";

  const closed = position;
  position = null;
  refreshPriceLines();
  renderAll();

  const record = {
    round: session.currentRoundNumber(),
    difficultyId: round.difficultyId,
    pair: round.pair.symbol,
    seed: round.seed,
    side: closed.side,
    leverage: closed.leverage,
    margin: closed.margin,
    notional: closed.notional,
    entryPrice: closed.entryPrice,
    closePrice: price,
    pnl: round2(pnl),
    pnlRatio: closed.margin > 0 ? (pnl / closed.margin) * 100 : 0,
    balanceAfter: settled.balance,
    reason,
  };

  session.addRoundRecord(record);

  // 去掉每回合的结算页：直接给一条提示，然后开下一回合（或结束本局）
  const summary = `第 ${record.round} 回合：${fmtSignedMoney(record.pnl)} USD（${fmtSignedPercent(
    record.pnlRatio
  )}）`;
  finishOrContinue(summary);
}

/** 结算后决定去哪：直接开下一回合，或进一局结束页 */
function finishOrContinue(summary) {
  const lastRound = session.isLastRound();
  const broke = !session.canContinue();

  if (lastRound || broke) {
    session.finishGame(lastRound ? "rounds" : "broke");
    saveFinishedGame();
    go("gameover");
    return;
  }

  session.advanceRound();
  startRound({ difficultyId: session.getGame().difficultyId });
  toast(`${summary} · 进入第 ${session.currentRoundNumber()} 回合`, 3200);
}

/** 把这一局的成绩写进本地存档（最近 10 局） */
function saveFinishedGame() {
  const game = session.getGame();
  if (!game) return;
  const stats = session.getStats();
  storage.saveGame({
    at: Date.now(),
    difficultyId: game.difficultyId,
    reason: game.finishReason,
    initialBalance: stats.initialBalance,
    finalBalance: stats.finalBalance,
    pnl: stats.totalPnl,
    returnRate: stats.returnRate,
    rounds: stats.rounds,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
  });
}

/* ==========================================================================
   8. 强制平仓
   ========================================================================== */

function liquidateNow() {
  if (!position) return;
  closePosition("liquidation", stopPriceFor(position));
}

function handleLiquidation() {
  if (phase !== "open" || !position) return;

  if (!shouldShowLiquidationDialog(remainingNow())) {
    liquidateNow();
    return;
  }
  openLiquidateDialog();
}

/* ---- 强平弹窗 ---- */

function liqStep() {
  const account = acc();
  return account ? Math.max(1, round2(account.balance * GAME.marginRatio.step)) : 1;
}

function liqMax() {
  const account = acc();
  if (!account) return 0;
  const step = liqStep();
  const available = availableOf(account);
  const steps = Math.floor(available / step);
  return steps > 0 ? round2(steps * step) : 0;
}

function openLiquidateDialog() {
  if (!liquidateDialog || !position) return;
  pauseClock();

  const max = liqMax();
  liqAmount = max > 0 ? Math.min(max, liqStep()) : 0;

  const range = el.liq.range;
  if (range) {
    const step = liqStep();
    range.min = String(max > 0 ? Math.min(step, max) : 0);
    range.max = String(max);
    range.step = String(step);
    range.value = String(liqAmount);
    range.disabled = max <= 0;
  }

  renderLiquidateDialog();
  renderTimer();
  liquidateDialog.showModal();
}

function renderLiquidateDialog() {
  if (!position) return;
  const account = acc();
  if (!account) return;

  const price = currentPrice();
  const pnl = pnlAt(position, price);
  const stop = stopPriceFor(position);
  const loss = Math.max(0, -pnl);

  const set = (node, text) => {
    if (node) node.textContent = text;
  };

  set(el.liq.loss, `${fmtMoney(loss)} USD`);
  set(el.liq.cumMargin, `${fmtMoney(position.margin)} USD`);
  set(el.liq.stopLoss, `${fmtMoney(liquidationLossFor(position))} USD`);
  set(el.liq.stopPrice, fmtPrice(stop));
  set(el.liq.available, `${fmtMoney(availableOf(account))} USD`);

  const max = liqMax();
  const usable = max > 0;
  if (el.liq.amount) {
    el.liq.amount.textContent = usable ? `${fmtMoney(liqAmount)} USD` : "无法追加";
  }
  if (el.liq.fillLoss) {
    el.liq.fillLoss.textContent = `${fmtMoney(liquidationLossFor(position))} USD`;
  }
  if (el.liq.noFunds) el.liq.noFunds.hidden = usable;
  if (el.liq.addBtn) el.liq.addBtn.disabled = !usable || liqAmount <= 0;
  el.liq.quickBtns.forEach((btn) => (btn.disabled = !usable));

  if (el.liq.range) {
    const fill = max > 0 ? (liqAmount / max) * 100 : 0;
    el.liq.range.style.setProperty("--fill", `${fill.toFixed(1)}%`);
  }

  const after = round2(position.margin + liqAmount);
  const afterLoss = round2(after * GAME.liquidationRatio);
  const afterStop = position.entryPrice * (1 - position.dir * (afterLoss / position.notional));

  set(el.liq.afterMargin, `${fmtMoney(after)} USD`);
  set(el.liq.afterStopLoss, `${fmtMoney(afterLoss)} USD`);
  set(el.liq.afterStopPrice, usable ? fmtPrice(afterStop) : "—");
}

function applyLiquidationAdd() {
  const account = acc();
  if (!position || !account || liqAmount <= 0) return;

  if (!freezeMargin(account, liqAmount)) {
    toast("可用资金不足，追加失败", 2600);
    return;
  }
  addMarginToPosition(position, liqAmount);
  refreshPriceLines();
  renderAll();

  liquidateDialog.close();
  resumeClock();

  toast(`已追加保证金 ${fmtMoney(liqAmount)} USD，强平价推至 ${fmtPrice(stopPriceFor(position))}`, 3000);

  if (isLiquidatedAt(position, currentPrice())) {
    handleLiquidation();
  }
}

/* ==========================================================================
   9. 平仓确认弹窗
   ========================================================================== */

function openConfirmDialog() {
  if (!confirmDialog || !position || phase !== "open") return;
  pauseClock();

  const price = currentPrice();
  const pnl = pnlAt(position, price);
  const ratio = pnlRatioAt(position, price);

  const c = el.confirm;
  if (c.side) c.side.textContent = position.side === "long" ? sideText("long") : sideText("short");
  if (c.leverage) c.leverage.textContent = `${position.leverage}×`;
  if (c.entryPrice) c.entryPrice.textContent = fmtPrice(position.entryPrice);
  if (c.currentPrice) c.currentPrice.textContent = fmtPrice(price);
  if (c.floating) {
    c.floating.textContent = `${fmtSignedMoney(pnl)} (${fmtSignedPercent(ratio)})`;
    setSignClass(c.floating, pnl);
  }

  renderTimer();
  confirmDialog.showModal();
}

/* ==========================================================================
   10. 计时与行情推进
   ========================================================================== */

function startTick() {
  stopTick();
  tickId = window.setInterval(onTick, TICK_MS);
  onTick();
}

function stopTick() {
  if (tickId !== null) {
    window.clearInterval(tickId);
    tickId = null;
  }
}

function onTick() {
  if (phase !== "open" || !round) return;

  const elapsed = elapsedNow();
  revealUpTo(elapsed);
  if (phase !== "open") return;

  renderHeader();
  renderPosition();
  renderAccount();
  renderTimer();
  renderStopBadge();

  if (elapsed >= ROUND_MS) {
    closePosition("auto");
  }
}

function revealUpTo(elapsed) {
  const interval = round.difficulty.candleIntervalMs;
  const target = Math.min(round.candles.length, round.historyCount + Math.floor(elapsed / interval));

  while (round.shown < target) {
    const candle = round.candles[round.shown];
    view?.update(toChartCandle(candle));
    round.shown += 1;

    if (position && isLiquidatedAt(position, candle.close)) {
      renderHeader();
      renderPosition();
      renderAccount();
      renderReveal();
      handleLiquidation();
      return;
    }
  }
  renderReveal();
}

/* ==========================================================================
   11. 交互绑定
   ========================================================================== */

function buildLeverageChips() {
  if (!el.leverageChips) return;
  el.leverageChips.innerHTML = GAME.leverageOptions
    .map((lev) => `<button type="button" data-leverage="${lev}" aria-pressed="false">${lev}×</button>`)
    .join("");

  el.leverageChips.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-leverage]");
    if (!btn || phase !== "ready") return;
    form.leverage = Number(btn.dataset.leverage);
    renderForm();
  });
}

function bindOrderForm() {
  el.sideButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (phase !== "ready") return;
      form.side = btn.dataset.side;
      renderForm();
    });
  });

  if (el.range) {
    el.range.min = String(Math.round(GAME.marginRatio.min * 100));
    el.range.max = String(Math.round(GAME.marginRatio.max * 100));
    el.range.step = String(Math.round(GAME.marginRatio.step * 100));
    el.range.value = String(form.ratioPercent);
    el.range.addEventListener("input", () => {
      if (phase !== "ready") return;
      form.ratioPercent = snapRatio(Number(el.range.value));
      renderForm();
    });
  }
}

/** 返回首页：持仓中禁止；对局进行中会先确认放弃 */
function requestExit() {
  if (phase === "open") {
    toast("持仓中不能返回，请先平仓。", 2600);
    return;
  }
  if (session.isGameActive()) {
    abandonDialog?.showModal();
    return;
  }
  go("home");
}

function bindTradeActions() {
  const root = document.querySelector('[data-screen="trade"]');
  if (!root) return;

  root.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-trade-action]");
    if (!btn) return;

    switch (btn.dataset.tradeAction) {
      case "exit":
        requestExit();
        break;

      case "copy-seed":
        if (!round) return;
        copyText(round.seed).then((ok) =>
          toast(ok ? `已复制种子 ${round.seed}` : `种子：${round.seed}（复制失败，请手动记录）`)
        );
        break;

      case "open":
        openPosition();
        break;

      case "close":
        openConfirmDialog();
        break;

      default:
        break;
    }
  });
}

function bindLiquidateDialog() {
  if (!liquidateDialog) return;
  liquidateDialog.addEventListener("cancel", (event) => event.preventDefault());

  el.liq.range?.addEventListener("input", () => {
    liqAmount = Number(el.liq.range.value);
    renderLiquidateDialog();
  });

  el.liq.quickBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const account = acc();
      if (!account) return;
      const max = liqMax();
      const step = liqStep();
      const available = availableOf(account);
      const ratio =
        btn.dataset.liqQuick === "quarter" ? 0.25 : btn.dataset.liqQuick === "half" ? 0.5 : 1;
      const raw = round2(available * ratio);
      liqAmount = Math.min(max, Math.max(step, round2(Math.floor(raw / step) * step)));
      if (el.liq.range) el.liq.range.value = String(liqAmount);
      renderLiquidateDialog();
    });
  });

  liquidateDialog.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-liq-action]");
    if (!btn) return;

    if (btn.dataset.liqAction === "add") {
      applyLiquidationAdd();
    } else if (btn.dataset.liqAction === "end") {
      liquidateDialog.close();
      liquidateNow();
    }
  });
}

function bindConfirmDialog() {
  if (!confirmDialog) return;
  confirmDialog.addEventListener("cancel", (event) => event.preventDefault());

  confirmDialog.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-confirm-action]");
    if (!btn) return;

    if (btn.dataset.confirmAction === "confirm") {
      confirmDialog.close();
      closePosition("manual");
    } else {
      confirmDialog.close();
      resumeClock();
    }
  });
}

function bindAbandonDialog() {
  if (!abandonDialog) return;
  abandonDialog.addEventListener("cancel", (event) => event.preventDefault());

  abandonDialog.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-abandon-action]");
    if (!btn) return;

    abandonDialog.close();
    if (btn.dataset.abandonAction === "confirm") {
      session.resetGame();
      stopTick();
      go("home");
    }
  });
}

/* ==========================================================================
   12. 屏幕进出与初始化
   ========================================================================== */

function handleEnter() {
  if (!round) {
    // 直接从地址栏进入但没有回合：有对局就开一回合，没有就回难度选择
    if (session.isGameActive()) {
      startRound({ difficultyId: session.getGame().difficultyId });
      return;
    }
    go("difficulty");
    return;
  }
  drawChart();
  refreshPriceLines();
  renderAll();
  if (phase === "open") resumeClock();
}

export function initTrade() {
  cacheEls();
  buildLeverageChips();
  bindOrderForm();
  bindTradeActions();
  bindLiquidateDialog();
  bindConfirmDialog();
  bindAbandonDialog();

  onScreenEnter("trade", handleEnter);
  onScreenLeave("trade", () => pauseClock());

  renderAll();
}
