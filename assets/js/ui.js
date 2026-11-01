/**
 * ui.js — 界面基础设施
 *
 *   1. 屏幕切换（同一时间只显示一个 .screen）+ 进出钩子
 *   2. 轻提示 toast、信息弹窗 dialog
 *   3. 文案注入（copy.js → data-copy 元素）
 *   4. 数字/金额格式化小工具
 *
 * 各页面模块（首页、难度、行情）只调用这里的函数，互相不直接依赖。
 */

import { GAME } from "./config.js";
import { COPY, LABELS } from "./copy.js";

/* ==========================================================================
   1. 屏幕切换
   ========================================================================== */

const screenEls = new Map();
const enterHooks = new Map();
const leaveHooks = new Map();
let currentScreen = null;

export function initScreens() {
  document.querySelectorAll("[data-screen]").forEach((el) => {
    screenEls.set(el.dataset.screen, el);
  });
}

/** 注册「进入某屏幕时」的回调（用于延迟创建图表、启动计时等） */
export function onScreenEnter(name, fn) {
  if (!enterHooks.has(name)) enterHooks.set(name, []);
  enterHooks.get(name).push(fn);
}

/** 注册「离开某屏幕时」的回调（用于清理计时器） */
export function onScreenLeave(name, fn) {
  if (!leaveHooks.has(name)) leaveHooks.set(name, []);
  leaveHooks.get(name).push(fn);
}

export function currentScreenName() {
  return currentScreen;
}

/**
 * 切换屏幕。
 * @param {string} name data-screen 的名字
 */
export function go(name) {
  const target = screenEls.get(name);
  if (!target) {
    console.warn(`[ui] 找不到屏幕：${name}`);
    return;
  }
  if (currentScreen === name) return;

  const previous = currentScreen;
  if (previous) {
    (leaveHooks.get(previous) || []).forEach((fn) => fn(previous, name));
  }

  screenEls.forEach((el, key) => {
    el.classList.toggle("is-active", key === name);
  });
  currentScreen = name;

  (enterHooks.get(name) || []).forEach((fn) => fn(name, previous));
}

/* ==========================================================================
   2. 轻提示 toast
   ========================================================================== */

const toastRoot = document.getElementById("toast-root");

export function toast(message, duration = 2600) {
  if (!toastRoot) return;

  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  toastRoot.appendChild(el);

  window.setTimeout(() => {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 400);
  }, duration);
}

/* ==========================================================================
   3. 信息弹窗
   ========================================================================== */

const dialog = document.getElementById("info-dialog");
const dialogTitle = document.getElementById("info-dialog-title");
const dialogBody = document.getElementById("info-dialog-body");
const dialogScroll = document.getElementById("info-dialog-scroll");

function updateScrollHint() {
  if (!dialogBody || !dialogScroll) return;
  const hasMore =
    dialogBody.scrollHeight - dialogBody.scrollTop - dialogBody.clientHeight > 4;
  dialogScroll.classList.toggle("has-more", hasMore);
}

export function initDialog() {
  if (!dialog) return;

  dialog.querySelectorAll("[data-dialog-close]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialogBody?.addEventListener("scroll", updateScrollHint, { passive: true });
  window.addEventListener("resize", () => {
    if (dialog.open) updateScrollHint();
  });
}

/**
 * 打开信息弹窗。
 * @param {{title: string, html: string}} options
 */
export function openDialog({ title, html }) {
  if (!dialog) return;
  dialogTitle.textContent = title;
  dialogBody.innerHTML = html;
  dialog.showModal();
  dialogBody.scrollTop = 0;
  updateScrollHint();
}

/* ==========================================================================
   4. 文案注入
   ========================================================================== */

export function applyCopy() {
  document.title = COPY.pageTitle;

  document.querySelectorAll("[data-copy]").forEach((el) => {
    const value = COPY[el.dataset.copy];
    if (typeof value === "string") el.textContent = value;
  });

  // 脚注末尾自动接上版本号
  const footnote = document.querySelector('[data-copy="footnote"]');
  if (footnote) {
    footnote.textContent = `${COPY.footnote} · ${GAME.version}`;
  }
}

/**
 * 字段名注入：把 copy.js 里的 LABELS 填进 [data-label] 元素。
 * 这些是"固定术语"（账户余额、名义仓位…），和宣传文案分开放。
 */
export function applyLabels() {
  document.querySelectorAll("[data-label]").forEach((el) => {
    const value = LABELS[el.dataset.label];
    if (typeof value === "string") el.textContent = value;
  });
}

/* ==========================================================================
   5. 格式化工具
   ========================================================================== */

/** 价格：固定 5 位小数（0.1 pip） */
export function fmtPrice(value, decimals = 5) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

/** 金额：千分位 + 2 位小数 */
export function fmtMoney(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 带符号的金额：+1,234.00 / −56.78（负号用真正的减号，比连字符更清晰） */
export function fmtSignedMoney(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${fmtMoney(Math.abs(value))}`;
}

/** 带符号的百分比：+0.42% / −1.05% */
export function fmtSignedPercent(value, decimals = 2) {
  if (!Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/**
 * 给元素设置盈利/亏损色（文档 §2.3：颜色必须与文字同时使用，
 * 所以调用方还要保证文本里已经带了 +/− 号或「盈利/亏损」字样）。
 */
export function setSignClass(el, value) {
  if (!el) return;
  el.classList.toggle("value-profit", value > 0);
  el.classList.toggle("value-loss", value < 0);
}

/** 复制文本到剪贴板，返回是否成功 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
