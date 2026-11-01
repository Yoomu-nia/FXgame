/**
 * storage.js — 本地存档（LocalStorage）
 *
 * 按已确认的范围，只存两样东西（不保存"进行中的对局"，刷新即放弃）：
 *   1. 游戏设置：上次选的难度
 *   2. 已完成对局的成绩：最近 10 局
 *
 * 所有读写都包了 try/catch：
 *   浏览器隐私模式、被禁用 Cookie、配额写满时 localStorage 会直接抛错，
 *   这里一律降级为"没有存档"，游戏本身照常能玩。
 */

const SETTINGS_KEY = "kline-coaster:settings:v1";
const HISTORY_KEY = "kline-coaster:history:v1";

/** 历史成绩最多保留多少局 */
export const MAX_HISTORY = 10;

function safeRead(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ==========================================================================
   1. 设置
   ========================================================================== */

/**
 * 读取设置。
 * @returns {{difficultyId: string|null}}
 */
export function loadSettings() {
  const data = safeRead(SETTINGS_KEY);
  const difficultyId = typeof data?.difficultyId === "string" ? data.difficultyId : null;
  return { difficultyId };
}

/**
 * 合并保存设置。
 * @param {object} patch
 */
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  safeWrite(SETTINGS_KEY, next);
  return next;
}

/* ==========================================================================
   2. 成绩历史
   ========================================================================== */

/** 一条成绩记录是否看起来是合法的 */
function isValidEntry(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    Number.isFinite(entry.pnl) &&
    Number.isFinite(entry.finalBalance) &&
    typeof entry.difficultyId === "string"
  );
}

/**
 * 读取历史成绩（最新在前）。
 * @returns {Array<object>}
 */
export function loadHistory() {
  const list = safeRead(HISTORY_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter(isValidEntry).slice(0, MAX_HISTORY);
}

/**
 * 追加一局成绩，只保留最近 MAX_HISTORY 局。
 * @param {object} entry
 * @returns {Array<object>} 保存后的列表
 */
export function saveGame(entry) {
  if (!isValidEntry(entry)) return loadHistory();
  const list = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
  safeWrite(HISTORY_KEY, list);
  return list;
}

/**
 * 历史最佳一局（按累计盈亏最高）。
 * @param {Array<object>} [list]
 * @returns {object|null}
 */
export function bestGame(list = loadHistory()) {
  return list.reduce((best, entry) => (best === null || entry.pnl > best.pnl ? entry : best), null);
}

/** 清空全部存档（调试用） */
export function clearAll() {
  try {
    window.localStorage.removeItem(SETTINGS_KEY);
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* 忽略 */
  }
}
