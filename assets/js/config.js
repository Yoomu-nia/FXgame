/**
 * config.js — 全局常量与难度参数（单一数据源）
 * 数值依据《K线过山车_V1.0_DSH开发需求文档》§3
 *
 * 说明：本文件只存放“数据”，不写逻辑。后续阶段（行情、交易、风险、统计）
 * 一律从这里读取参数，避免同一个数字在多处硬编码造成不一致。
 */

/** 全局游戏参数（文档 §3.1） */
export const GAME = {
  version: "V1.0",
  initialBalance: 10000,      // 初始账户资金（USD）
  currency: "USD",            // 账户计价货币
  historyCandles: 30,         // 每回合初始历史 K 线根数
  candleSeconds: 60,          // 每根 K 线代表 60 秒模拟时间
  roundSeconds: 60,           // 每回合交易时间（现实秒）
  leverageOptions: [1, 5, 10, 20, 50, 100], // 杠杆档位
  marginRatio: {
    min: 0.05,                // 初始保证金最低比例：账户余额 5%
    max: 1.0,                 // 最高 100%
    step: 0.05,               // 调节步长 5 个百分点
  },
  liquidationRatio: 0.9,      // 浮动亏损 ≥ 累计保证金 × 90% 触发强平
  liquidationDialogMinMs: 5000, // 剩余时间 < 5 秒时不再弹强平窗口，直接按强平价结算（文档 §6.4）
  liquidationFillAtThreshold: true, // 强平按"阈值价"成交：亏损恰好 90% 累计保证金，不穿仓
};

/** 交易品种（文档 §3.2）—— 均以 USD 为报价货币 */
export const PAIRS = [
  { symbol: "EUR/USD", base: "EUR", quote: "USD", name: "欧元 / 美元", basePrice: 1.0850 },
  { symbol: "GBP/USD", base: "GBP", quote: "USD", name: "英镑 / 美元", basePrice: 1.2680 },
  { symbol: "AUD/USD", base: "AUD", quote: "USD", name: "澳元 / 美元", basePrice: 0.6540 },
  { symbol: "NZD/USD", base: "NZD", quote: "USD", name: "纽元 / 美元", basePrice: 0.6120 },
];

/**
 * 难度预设（文档 §3.3）
 * - volatility  市场波动率（%）：控制单根 K 线价格变化幅度
 * - trend       趋势持续性（%）：行情沿当前方向延续的倾向
 * - shockProb   突发事件概率（%）：出现较大价格冲击的概率
 * - candleIntervalMs 行情生成速度：每根新 K 线出现的现实毫秒间隔
 * 注意：60 秒倒计时不随行情速度改变；难度整局锁定，不可中途修改。
 */
export const DIFFICULTIES = {
  normal: {
    id: "normal",
    name: "普通",
    enName: "NORMAL",
    volatility: 40,
    trend: 60,
    shockProb: 5,
    candleIntervalMs: 4000,
    desc: "波动温和、趋势延续性强，适合熟悉规则。",
  },
  hard: {
    id: "hard",
    name: "困难",
    enName: "HARD",
    volatility: 70,
    trend: 40,
    shockProb: 15,
    candleIntervalMs: 2000,
    desc: "波动与突发冲击明显增强，推荐难度。",
  },
  extreme: {
    id: "extreme",
    name: "极限",
    enName: "EXTREME",
    volatility: 95,
    trend: 20,
    shockProb: 25,
    candleIntervalMs: 1000,
    desc: "行情几乎没有惯性且冲击频繁，高杠杆极易被强平。",
  },
};

/** 默认推荐难度（文档 §3.3 / §8.2） */
export const DEFAULT_DIFFICULTY = "hard";

/** 难度展示顺序 */
export const DIFFICULTY_ORDER = ["normal", "hard", "extreme"];

/**
 * 首页外链图标（B站、GitHub 等）—— 改这里就能填链接
 *
 * 【怎么填链接】
 * 把对应条目的 url 改成完整地址即可，例如：
 *   { id: "bilibili", label: "Bilibili", icon: "tv", url: "https://space.bilibili.com/123456" }
 *   { id: "github",   label: "GitHub",   icon: "branch", url: "https://github.com/你的用户名" }
 *   { id: "email",    label: "Email",    icon: "mail", url: "mailto:你的邮箱@example.com" }
 *
 * 规则：
 *   填了 http(s):// 或 mailto: 的地址 → 渲染成可点击图标，新标签页打开；
 *   url 留空 → 渲染成**不可点击**的虚线占位图标（点击没有任何反应）；
 *   其它协议（例如 javascript:）会被当成"没填"，不会生成链接。
 *
 * icon 可选值见 app.js 的 ICONS：tv（B站）/ branch（GitHub）/ mail（邮箱）/ link（通用）
 * 想加平台就往这个数组里追加一条，首页会自动多出一个图标。
 */
export const SOCIAL_LINKS = [
  { id: "bilibili", label: "Bilibili", icon: "tv", url: "" },
  { id: "github", label: "GitHub", icon: "branch", url: "https://github.com/Yoomu-nia/FXgame" },
  { id: "email", label: "Email", icon: "mail", url: "" },
];
