/**
 * copy.js — 全站文案（唯一来源）
 *
 * 【怎么改文案】
 * 只改这个文件里的字符串，然后刷新浏览器即可，不需要动 HTML 或 app.js。
 *
 * 【当前状态】
 * 下面标了「待定」的条目都是首页占位文案 —— 先沿用原来这一版的说法，
 * 等文案定稿后直接替换字符串就行，页面结构和样式都不用改。
 *
 * 注意：Logo 拆成 logoLeft / logoHeart / logoRight 三段，
 * 是为了左右两段可以用不同颜色和渐变（见 home.css 的 .home__logo-* ）。
 */

export const COPY = {
  /* 浏览器标签页标题 —— 待定 */
  pageTitle: "K线♡过山车",

  /* 顶部小标签（英文小字）—— 待定 */
  eyebrow: "FX LEVERAGE SIMULATOR",

  /* 主标题：左 + 心形 + 右 —— 待定 */
  logoLeft: "K线",
  logoHeart: "♥",
  logoRight: "过山车",

  /* 副标题 —— 待定 */
  subtitle: "梭哈是一种智慧",

  /* 导语（一句话说明）—— 待定 */
  tagline: "“老实赚钱,很幸苦吧？”",

  /* 按钮文字 —— 待定 */
  startLabel: "FX,简单！",
  rulesLabel: "RULES",
  historyLabel: "HISTORY",

  /* 首页脚注（版本号会自动接在末尾）—— 待定 */
  footnote: "本游戏仅为虚构娱乐模拟，不涉真实资金，不构成投资建议也与任何真实机构无关",

  /* ===== 以下为阶段二新增：难度选择页 / 行情页 ===== */

  /* 难度选择页 */
  difficultyTitle: "选择难度",
  difficultyHint: "难度在整局固定，开局后不可更改。",
  difficultyBack: "返回首页",
  difficultyStart: "开始",
  difficultyRecommended: "推荐",

  /* 行情页（阶段二为行情预览，交易功能阶段三接入） */
  tradeExit: "← 返回",
  tradePreviewTag: "行情预览",
  tradeSeedLabel: "种子",
  tradeCopySeed: "复制种子",
  tradeReplay: "用此种子重放",
  tradeNewSeed: "换一个行情",

  /* ===== 以下为阶段三新增：交易界面 ===== */

  accountPanelTitle: "账户",
  accountNote: "保证金已冻结，可用资金不可用于垫付亏损。",
  orderPanelTitle: "下单",
  orderNote: "开仓后方向、杠杆、保证金比例均不可更改。",
  longLabel: "做多 ▲",
  shortLabel: "做空 ▼",
  openPosition: "开仓",
  closePosition: "平仓",
  resultHome: "返回首页",

  /* ===== 以下为阶段四新增：强平弹窗 / 平仓确认 ===== */

  liquidateTitle: "强制平仓警告",
  liquidateLead: "浮动亏损已达到累计保证金的 90%，仓位即将被强平。",
  liquidateChoice: "可以追加保证金继续持有，或立刻结束这笔交易。",
  addMarginButton: "追加保证金",
  endTradeButton: "结束交易",
  noFundsHint: "可用资金不足，无法追加，只能结束交易。",
  fillLossNote: "（不会穿仓）",
  quickQuarter: "25%",
  quickHalf: "50%",
  quickMax: "最大",

  confirmCloseTitle: "确认平仓",  confirmCloseLead: "确认现在平掉当前仓位吗？",
  confirmCloseNote: "确认弹窗期间行情与倒计时暂停。",
  confirmCloseYes: "确认平仓",
  confirmCloseNo: "继续持有",

  /* 结算弹窗里三种结局的说明 */
  reasonManual: "手动平仓",
  reasonAuto: "60 秒倒计时结束，自动平仓",
  reasonLiquidation: "浮动亏损达到累计保证金的 90%，强制平仓",

  /* ===== 以下为阶段五新增：结算页 / 一局结束 / 放弃确认 ===== */

  gameoverTitle: "本局结束",
  gameoverAgain: "再来一局",
  gameoverReasonRounds: "5 回合已打完，来看看这局成绩。",
  gameoverReasonBroke: "资金已不足以开出下一笔最低仓位，本局提前结束。",

  abandonTitle: "放弃本局",
  abandonLead: "确定放弃当前对局吗？本局进度不会保存。",
  abandonYes: "确认放弃",
  abandonNo: "继续游戏",

  /* ===== 首页「历史记录」弹窗 ===== */

  historyTitle: "历史记录",
  historyEmpty: "还没有打完的对局。开一局试试吧——撑满 5 回合才会记成绩。",
  historyBestLabel: "最佳一局",
  historyCountLabel: "已完成",
  historyRoundsUnit: "回合",
  historyBrokeTag: "爆仓",
};

/**
 * 界面上的字段名（表格标签用）。
 * 与 COPY 分开，是因为这些是"固定术语"，一般不需要跟着文案风格一起改。
 */
export const LABELS = {
  volatility: "市场波动率",
  trend: "趋势持续性",
  shockProb: "突发事件概率",
  speed: "行情生成速度",
  difficulty: "难度",
  perCandle: "秒/根",
  revealed: "本轮已揭示",
  candles: "根",

  /* 阶段三：账户与交易字段 */
  timer: "剩余",
  balance: "账户余额",
  available: "可用资金",
  marginUsed: "当前保证金",
  equity: "账户总权益",
  realized: "累计盈亏",
  leverage: "杠杆",
  ratio: "投入比例",
  marginAmount: "保证金",
  entryPrice: "开仓价",
  currentPrice: "当前价",
  closePrice: "平仓价",
  notional: "名义仓位",
  floating: "浮动盈亏",
  side: "方向",

  /* 阶段四：强平相关字段 */
  floatingLoss: "当前浮动亏损",
  stopPrice: "强平价",
  stopLoss: "强平阈值",
  cumMargin: "累计保证金",
  addAmount: "追加金额",
  afterMargin: "追加后累计保证金",
  afterStopLoss: "追加后强平阈值",
  afterStopPrice: "追加后强平价",
  fillLoss: "按强平价成交，实亏",

  /* 阶段五：结算页与成绩单字段 */
  pnlRatio: "本轮盈亏比例",
  pair: "交易品种",
  round: "回合",
  initialBalance: "初始资金",
  finalBalance: "最终资金",
  totalPnl: "累计盈亏",
  roundsPlayed: "总回合数",
  winRounds: "盈利回合",
  lossRounds: "亏损回合",
  winRate: "胜率",
  bestRound: "单轮最大盈利",
  worstRound: "单轮最大亏损",
  maxWinStreak: "最大连续盈利",
  maxLossStreak: "最大连续亏损",
};
