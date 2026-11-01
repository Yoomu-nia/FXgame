/**
 * app.js — 应用入口
 *
 * 这里只做"接线"：
 *   1. 初始化 UI 基础设施（屏幕、弹窗、文案）
 *   2. 首页交互（开始游戏 / 规则 / 设置 / 外链图标）
 *   3. 启动各页面模块（难度选择、行情页）
 *   4. 支持用 URL 参数直达某段行情，便于复现：index.html?difficulty=hard&seed=7A3F9C21
 *
 * 具体玩法逻辑分别在 difficulty.js / trade.js / market.js 里。
 */

import { GAME, SOCIAL_LINKS, DIFFICULTIES } from "./config.js";
import { COPY } from "./copy.js";import {
  initScreens,
  initDialog,
  applyCopy,
  applyLabels,
  go,
  openDialog,
  onScreenEnter,
  fmtSignedMoney,
  setSignClass,
} from "./ui.js";
import { initDifficulty } from "./difficulty.js";
import { initTrade, startRound } from "./trade.js";
import { initGameover, renderGameover } from "./gameover.js";
import * as session from "./session.js";
import * as storage from "./storage.js";

/* ==========================================================================
   1. 游戏规则弹窗（数字全部来自 config.js，避免规则与代码不一致）
   ========================================================================== */

function buildRulesHtml() {
  const lev = GAME.leverageOptions.join("×、") + "×";
  const minPct = Math.round(GAME.marginRatio.min * 100);
  const stepPct = Math.round(GAME.marginRatio.step * 100);
  const liqPct = Math.round(GAME.liquidationRatio * 100);

  return `
    <h3>这是什么样的游戏</h3>
    <ul>
      <li>用虚拟资金在程序生成的外汇行情里做多或做空，每回合 ${GAME.roundSeconds} 秒。</li>
      <li>全部使用模拟行情与虚拟资金，<strong>不涉及真实交易、充值或提现</strong>。</li>
    </ul>

    <h3>账户与报价</h3>
    <ul>
      <li>初始资金 <strong>${GAME.initialBalance.toLocaleString("en-US")} ${GAME.currency}</strong>，账户以美元计价。</li>
      <li>交易品种为 EUR/USD、GBP/USD、AUD/USD、NZD/USD，每回合随机选择一个。</li>
      <li>第一版<strong>不收取手续费，也没有点差</strong>。</li>
    </ul>

    <h3>开仓</h3>
    <ul>
      <li>方向：做多（看涨）或做空（看跌），开仓后方向不可更改。</li>
      <li>杠杆档位：${lev}。</li>
      <li>投入保证金：账户余额的 ${minPct}%～100%，每档 ${stepPct} 个百分点。</li>
      <li>名义仓位 = 投入保证金 × 杠杆。</li>
    </ul>

    <h3>盈亏怎么算</h3>
    <ul>
      <li>浮动盈亏 = 名义仓位 × （当前价 − 开仓价）÷ 开仓价 × 方向系数。</li>
      <li>做多方向系数为 <strong>+1</strong>，做空为 <strong>−1</strong>。</li>
      <li>盈亏只与开了多少名义仓位、价格走了多少有关，追加保证金不会放大盈亏。</li>
    </ul>

    <h3>强制平仓</h3>
    <ul>
      <li>当浮动亏损达到<strong>累计保证金（初始 + 追加）的 ${liqPct}%</strong> 时触发强平窗口。</li>
      <li>此时可以追加保证金继续持有，或立刻结束交易结算。</li>
      <li>追加保证金只提高累计保证金与强平阈值，不改变方向、开仓价和名义仓位。</li>
    </ul>

    <h3>回合结束</h3>
    <ul>
      <li>手动平仓、${GAME.roundSeconds} 秒倒计时结束自动平仓、或强平窗口中选择结束。</li>
      <li>平仓后结算本轮盈亏并更新账户资金，余额不足以开下一笔最低仓位时游戏结束。</li>
    </ul>
  `;
}

/* ==========================================================================
   2. 首页外链图标（config.js 的 SOCIAL_LINKS 决定显示什么）
   ========================================================================== */

/* 线性小图标：24×24 画布，颜色跟随 currentColor */
const ICONS = {
  // B站：小电视轮廓 + 天线 + 两只眼睛
  tv: `
    <svg class="social__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="7.5" width="18" height="12" rx="3.6" />
      <path d="M7.6 3.6 10.5 6.7M16.4 3.6 13.5 6.7" />
      <path d="M9.2 12.4v1.9M14.8 12.4v1.9" />
    </svg>`,
  // GitHub：分支节点（不复制官方 logo，避免商标与版权问题）
  branch: `
    <svg class="social__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="6.5" cy="5.5" r="2.3" />
      <circle cx="6.5" cy="18.5" r="2.3" />
      <circle cx="17.5" cy="7.5" r="2.3" />
      <path d="M6.5 7.8v8.4" />
      <path d="M17.5 9.8c0 4.2-3.6 5.1-7.2 5.4-2 .2-3.8.6-3.8 1.1" />
    </svg>`,
  // 邮箱：信封
  mail: `
    <svg class="social__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M3.8 7.2 12 13.1l8.2-5.9" />
    </svg>`,
  // 通用占位
  link: `
    <svg class="social__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>`,
};

/** 只允许 http(s) 与 mailto，其它（例如 javascript:）一律当成"没填" */
function isSafeUrl(url) {
  return typeof url === "string" && /^(https?:\/\/|mailto:)/i.test(url.trim());
}

function renderSocialLinks() {
  const root = document.getElementById("home-social");
  if (!root) return;

  root.innerHTML = SOCIAL_LINKS.map((link) => {
    const icon = ICONS[link.icon] || ICONS.link;
    const label = link.label;

    if (isSafeUrl(link.url)) {
      return `<a class="social__link" href="${link.url.trim()}"
                target="_blank" rel="noopener noreferrer"
                title="${label}" aria-label="${label}">${icon}</a>`;
    }

    // 还没填地址：渲染成不可点击的占位图标（点击没有任何反应，也不会弹提示）
    return `<span class="social__link is-pending"
              title="${label}" aria-label="${label}"
              role="img" aria-disabled="true">${icon}</span>`;
  }).join("");
}

/* ==========================================================================
   2.5 首页：历史记录弹窗
   ========================================================================== */

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 时间戳 → "11/2 05:30" */
function formatWhen(ts) {
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function buildHistoryHtml() {
  const list = storage.loadHistory();

  if (!list.length) {
    return `<p class="history__empty">${COPY.historyEmpty}</p>`;
  }

  const best = storage.bestGame(list);
  const rows = list
    .map((entry) => {
      const difficultyName = DIFFICULTIES[entry.difficultyId]?.name ?? "—";
      const broke = entry.reason === "broke";
      const meta = [
        difficultyName,
        `${entry.rounds}/${session.ROUNDS_PER_GAME} ${COPY.historyRoundsUnit}${broke ? ` · ${COPY.historyBrokeTag}` : ""}`,
      ].join(" · ");
      const signClass = entry.pnl > 0 ? "value-profit" : entry.pnl < 0 ? "value-loss" : "";

      return `
        <li class="history__row">
          <span class="history__when num">${formatWhen(entry.at)}</span>
          <span class="history__meta">${meta}</span>
          <span class="history__pnl num ${signClass}">${fmtSignedMoney(entry.pnl)}</span>
        </li>`;
    })
    .join("");

  return `
    <div class="history__summary">
      <span>${COPY.historyCountLabel} <b class="num">${list.length}</b> 局</span>
      <span>${COPY.historyBestLabel}
        <b class="num ${best && best.pnl > 0 ? "value-profit" : best && best.pnl < 0 ? "value-loss" : ""}">
          ${fmtSignedMoney(best ? best.pnl : 0)} USD
        </b>
      </span>
    </div>
    <ul class="history__list">${rows}</ul>
  `;
}

/* ==========================================================================
   3. 首页交互
   ========================================================================== */

function initHome() {
  const home = document.querySelector('[data-screen="home"]');
  if (!home) return;

  home.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;

    switch (btn.dataset.action) {
      case "start":
        go("difficulty");
        break;

      case "rules":
        openDialog({ title: "游戏规则", html: buildRulesHtml() });
        break;

      case "history":
        openDialog({ title: COPY.historyTitle, html: buildHistoryHtml() });
        break;

      default:
        break;
    }
  });
}

/* ==========================================================================
   4. 首页：历史最佳一局
   ========================================================================== */

function renderHomeBest() {
  const node = document.querySelector('[data-home="best"]');
  if (!node) return;

  const best = storage.bestGame();
  if (!best) {
    node.hidden = true;
    node.textContent = "";
    return;
  }

  const difficultyName = DIFFICULTIES[best.difficultyId]?.name ?? "—";
  const when = best.at ? new Date(best.at) : null;
  const dateText = when
    ? `${when.getMonth() + 1}/${when.getDate()}`
    : "";

  node.hidden = false;
  node.textContent = "";
  const label = document.createTextNode("最佳一局：");
  const amount = document.createElement("b");
  amount.textContent = `${fmtSignedMoney(best.pnl)} USD`;
  setSignClass(amount, best.pnl);
  const meta = document.createTextNode(
    `（${difficultyName} · ${best.rounds} 回合${dateText ? ` · ${dateText}` : ""}）`
  );
  node.append(label, amount, meta);
}

/* ==========================================================================
   5. 启动
   ========================================================================== */

/** 支持 index.html?difficulty=hard&seed=7A3F9C21 直接进入一段指定行情（便于复现/调试） */
function autoStartFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const difficultyId = params.get("difficulty");
  const seed = params.get("seed");
  if (!difficultyId) return;

  if (!DIFFICULTIES[difficultyId]) {
    console.warn(`[app] URL 里的难度无效：${difficultyId}`);
    return;
  }
  session.startGame({ difficultyId });
  startRound({ difficultyId, seed: seed || undefined });
}

function boot() {
  initScreens();
  initDialog();
  applyCopy();
  applyLabels();
  renderSocialLinks();
  initHome();
  initTrade();
  initDifficulty();
  initGameover();

  // 一局结束页在进入时按 session 里的最终数据渲染
  onScreenEnter("gameover", renderGameover);
  // 每次回首页刷新「最佳一局」（刚打完一局时数字会更新）
  onScreenEnter("home", renderHomeBest);

  go("home");
  renderHomeBest();
  autoStartFromUrl();

  console.info(`[K线过山车] ${GAME.version} 启动完成`);
}

boot();
