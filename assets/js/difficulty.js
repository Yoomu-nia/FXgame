/**
 * difficulty.js — 难度选择页（文档 §3.3 / §8.2）
 *
 * 三档难度的参数直接渲染自 config.js 的 DIFFICULTIES，
 * 所以改难度数值只需要改 config.js，页面会自动跟着变。
 */

import { DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY } from "./config.js";
import { COPY, LABELS } from "./copy.js";
import { go, toast } from "./ui.js";
import { startRound } from "./trade.js";
import * as session from "./session.js";
import * as storage from "./storage.js";

let selectedId = DEFAULT_DIFFICULTY;
let cardsRoot = null;

/** 行情生成速度：4000ms → "4 秒/根" */
function speedText(intervalMs) {
  const seconds = intervalMs / 1000;
  const text = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${text} ${LABELS.perCandle}`;
}

function statRow(label, value) {
  return `
    <li class="diffcard__stat">
      <span class="diffcard__statlabel">${label}</span>
      <b class="diffcard__statvalue num">${value}</b>
    </li>`;
}

function cardHtml(difficulty) {
  const recommended = difficulty.id === DEFAULT_DIFFICULTY;
  return `
    <button class="diffcard" type="button" role="radio" aria-checked="false"
            data-diff="${difficulty.id}" aria-label="${difficulty.name}难度">
      ${recommended ? `<span class="diffcard__badge">${COPY.difficultyRecommended}</span>` : ""}
      <span class="diffcard__head">
        <span class="diffcard__name">${difficulty.name}</span>
        <span class="diffcard__en">${difficulty.enName}</span>
      </span>
      <span class="diffcard__desc">${difficulty.desc}</span>
      <ul class="diffcard__stats">
        ${statRow(LABELS.volatility, `${difficulty.volatility}%`)}
        ${statRow(LABELS.trend, `${difficulty.trend}%`)}
        ${statRow(LABELS.shockProb, `${difficulty.shockProb}%`)}
        ${statRow(LABELS.speed, speedText(difficulty.candleIntervalMs))}
      </ul>
    </button>`;
}

function paintSelection() {
  if (!cardsRoot) return;
  cardsRoot.querySelectorAll("[data-diff]").forEach((card) => {
    const isSelected = card.dataset.diff === selectedId;
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
  });
}

/** 供外部查询/设置（页面返回时保持上次选择） */
export function getSelectedDifficulty() {
  return selectedId;
}

export function initDifficulty() {
  cardsRoot = document.getElementById("difficulty-cards");
  if (!cardsRoot) return;

  // 上次玩过的难度优先（存档坏了就用默认推荐难度）
  const saved = storage.loadSettings().difficultyId;
  if (saved && DIFFICULTIES[saved]) selectedId = saved;

  cardsRoot.innerHTML = DIFFICULTY_ORDER.map((id) =>
    cardHtml(DIFFICULTIES[id])
  ).join("");

  cardsRoot.addEventListener("click", (event) => {
    const card = event.target.closest("[data-diff]");
    if (!card) return;
    selectedId = card.dataset.diff;
    paintSelection();
  });

  // 键盘：左右/上下方向键在三档之间切换（符合 radiogroup 习惯）
  cardsRoot.addEventListener("keydown", (event) => {
    const card = event.target.closest("[data-diff]");
    if (!card) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = DIFFICULTY_ORDER.indexOf(selectedId);
    selectedId =
      DIFFICULTY_ORDER[(index + step + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length];
    paintSelection();
    cardsRoot.querySelector(`[data-diff="${selectedId}"]`)?.focus();
  });

  document
    .querySelector('[data-difficulty-action="back"]')
    ?.addEventListener("click", () => go("home"));

  document
    .querySelector('[data-difficulty-action="start"]')
    ?.addEventListener("click", () => {
      const difficulty = DIFFICULTIES[selectedId];
      toast(`难度已锁定：${difficulty.name} · 一局 ${session.ROUNDS_PER_GAME} 回合`, 2200);
      storage.saveSettings({ difficultyId: selectedId });
      session.startGame({ difficultyId: selectedId });
      startRound({ difficultyId: selectedId });
    });

  paintSelection();
}
