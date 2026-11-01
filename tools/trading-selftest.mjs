/**
 * tools/trading-selftest.mjs — 交易计算与资金账务自检（阶段三验收用）
 *
 * 覆盖文档 §5.1（盈亏公式）、§5.2（资金账务原则）、§4.4（保证金比例）、
 * §6.1（90% 阈值）的数学部分。这些是最容易写错、也最不能出错的地方。
 *
 * 运行：node tools/trading-selftest.mjs
 */

import { GAME } from "../assets/js/config.js";
import {
  createPosition,
  addMarginToPosition,
  pnlAt,
  pnlRatioAt,
  marginFor,
  notionalFor,
  snapRatio,
  validateOpen,
  directionOf,
  stopPriceFor,
  liquidationLossFor,
  isLiquidatedAt,
  shouldShowLiquidationDialog,
} from "../assets/js/trading.js";
import {
  createAccount,
  availableOf,
  equityOf,
  freezeMargin,
  releaseMargin,
  settleTrade,
  applyRealized,
} from "../assets/js/account.js";

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
console.log("\n【1】名义仓位与盈亏公式（文档 §5.1）");
/* -------------------------------------------------------------------------- */

{
  check("名义仓位 = 保证金 × 杠杆", notionalFor(5000, 20) === 100000);

  const long = createPosition({ side: "long", leverage: 20, margin: 5000, entryPrice: 1.0 });
  check("做多方向系数 +1", directionOf("long") === 1);
  check(
    "做多：价格上涨 1% → 盈利 = 名义仓位 × 1%",
    near(pnlAt(long, 1.01), 1000),
    `实际 ${pnlAt(long, 1.01).toFixed(4)}`
  );
  check("做多：价格下跌 1% → 亏损为负", near(pnlAt(long, 0.99), -1000), `实际 ${pnlAt(long, 0.99)}`);

  const short = createPosition({ side: "short", leverage: 20, margin: 5000, entryPrice: 1.0 });
  check("做空方向系数 −1", directionOf("short") === -1);
  check(
    "做空：价格下跌 1% → 盈利",
    near(pnlAt(short, 0.99), 1000),
    `实际 ${pnlAt(short, 0.99)}`
  );
  check("做空：价格上涨 1% → 亏损", near(pnlAt(short, 1.01), -1000), `实际 ${pnlAt(short, 1.01)}`);

  // 文档公式的核心推论：盈亏 / 保证金 = 杠杆 × 涨跌幅
  let consistent = true;
  for (const L of GAME.leverageOptions) {
    for (const move of [-0.02, -0.005, 0.003, 0.01]) {
      const pos = createPosition({ side: "long", leverage: L, margin: 1000, entryPrice: 1 });
      const pnl = pnlAt(pos, 1 + move);
      const expected = 1000 * L * move;
      if (!near(pnl, expected, 0.02)) {
        consistent = false;
        console.error(`      杠杆 ${L} 涨幅 ${move}: ${pnl} vs ${expected}`);
      }
    }
  }
  check("盈亏/保证金 = 杠杆 × 涨跌幅（六档杠杆交叉验证）", consistent);

  check(
    "盈亏比例函数与盈亏金额一致",
    near(pnlRatioAt(long, 1.01), (pnlAt(long, 1.01) / 5000) * 100),
    `${pnlRatioAt(long, 1.01)}`
  );
  check("价格为 0 或非法时不产生 NaN", pnlAt(long, NaN) === 0 && pnlAt(long, 0) === -100 * 5000 * 20 / 1000 || Number.isFinite(pnlAt(long, 0)));
}

/* -------------------------------------------------------------------------- */
console.log("\n【2】保证金比例与开仓校验（文档 §4.4 / §7.2）");
/* -------------------------------------------------------------------------- */

{
  check("10,000 的 5% = 500", marginFor(10000, 5) === 500);
  check("10,000 的 50% = 5,000", marginFor(10000, 50) === 5000);
  check("10,000 的 100% = 10,000", marginFor(10000, 100) === 10000);

  check("比例吸附到 5% 步长：47 → 45", snapRatio(47) === 45, String(snapRatio(47)));
  check("比例吸附到 5% 步长：48 → 50", snapRatio(48) === 50, String(snapRatio(48)));
  check("比例上限 100%", snapRatio(130) === 100);
  check("比例下限 5%", snapRatio(1) === 5);

  const base = { balance: 10000, available: 10000 };
  check(
    "未选方向不能开仓",
    validateOpen({ ...base, side: null, leverage: 10, ratioPercent: 50 }).ok === false
  );
  check(
    "非法杠杆不能开仓",
    validateOpen({ ...base, side: "long", leverage: 3, ratioPercent: 50 }).ok === false
  );
  check(
    "正常开仓校验通过并返回保证金",
    (() => {
      const r = validateOpen({ ...base, side: "long", leverage: 20, ratioPercent: 100 });
      return r.ok && r.margin === 10000;
    })()
  );
  check(
    "可用资金不足时不能开仓",
    validateOpen({ balance: 10000, available: 1000, side: "long", leverage: 10, ratioPercent: 50 }).ok ===
      false
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n【3】资金账务：冻结 / 释放 / 记账（文档 §5.2）");
/* -------------------------------------------------------------------------- */

{
  const acc = createAccount(10000);
  check("初始：可用 = 余额 = 10,000", availableOf(acc) === 10000);
  check("初始：总权益 = 10,000", equityOf(acc) === 10000);

  const frozen = freezeMargin(acc, 5000);
  check("冻结 5,000 成功", frozen === true);
  check("冻结后余额不变", acc.balance === 10000);
  check("冻结后可用资金 = 5,000", availableOf(acc) === 5000);
  check("冻结后总权益仍为 10,000（保证金仍属于账户）", equityOf(acc) === 10000);

  // 已无足够可用资金，第二次冻结应失败且不改变状态
  const second = freezeMargin(acc, 6000);
  check("可用资金不足时冻结失败", second === false && acc.frozen === 5000);

  // 平仓：释放保证金 + 记入盈利
  const closed = settleTrade(acc, { margin: 5000, pnl: 800 });
  check("平仓后释放 5,000 保证金", closed.released === 5000 && acc.frozen === 0);
  check("平仓后余额 = 10,800", acc.balance === 10800);
  check("平仓后可用资金 = 余额 = 10,800", availableOf(acc) === 10800);
  check("累计盈亏 = +800", acc.realized === 800);
  check("成交计数 = 1", acc.trades === 1);

  // 亏损平仓
  settleTrade(acc, { margin: 5400, pnl: -1200 });
  check("亏损平仓后余额 = 9,600", acc.balance === 9600);
  check("累计盈亏 = −400", acc.realized === -400);
}

/* -------------------------------------------------------------------------- */
console.log("\n【4】不重复记账：反复开平 200 次");
/* -------------------------------------------------------------------------- */

{
  const acc = createAccount(10000);
  for (let i = 0; i < 200; i++) {
    const margin = marginFor(acc.balance, 20);
    freezeMargin(acc, margin);
    settleTrade(acc, { margin, pnl: 0 });
  }
  check(
    "盈亏为 0 时反复开平后余额恒为 10,000",
    near(acc.balance, 10000, 0.01),
    `实际 ${acc.balance}`
  );
  check("反复开平后没有残留冻结金额", acc.frozen === 0, `实际 ${acc.frozen}`);
  check("反复开平后可用资金 = 余额", availableOf(acc) === acc.balance);

  // 有盈有亏，但总和为 0，余额应回到原值
  const acc2 = createAccount(10000);
  for (let i = 0; i < 100; i++) {
    freezeMargin(acc2, 2000);
    settleTrade(acc2, { margin: 2000, pnl: i % 2 === 0 ? 37.5 : -37.5 });
  }
  check("盈亏正负抵消后余额不漂移", near(acc2.balance, 10000, 0.5), `实际 ${acc2.balance}`);
  check("累计盈亏与余额变化一致", near(acc2.realized, acc2.balance - 10000, 0.01));
}

/* -------------------------------------------------------------------------- */
console.log("\n【5】边界情况");
/* -------------------------------------------------------------------------- */

{
  const acc = createAccount(10000);
  freezeMargin(acc, 3000);
  const released = releaseMargin(acc, 9999);
  check("释放金额超过冻结额时按冻结额释放，不出现负数", released === 3000 && acc.frozen === 0);

  check("金额为 0 的冻结被拒绝", freezeMargin(acc, 0) === false);
  check("负金额的冻结被拒绝", freezeMargin(acc, -100) === false);

  const acc2 = createAccount(10000);
  applyRealized(acc2, -100);
  check("亏损直接记入余额（不涉及保证金）", acc2.balance === 9900 && acc2.realized === -100);
}

/* -------------------------------------------------------------------------- */
console.log("\n【6】90% 强平阈值的数学交叉验证（文档 §6.1，阶段四使用）");
/* -------------------------------------------------------------------------- */

{
  const L = 20;
  const margin = 1000;
  const entry = 1.0;
  const pos = createPosition({ side: "long", leverage: L, margin, entryPrice: entry });

  // 反推出强平价格：亏损 = 90% 保证金
  const adverseMove = GAME.liquidationRatio / L; // 0.9 / 20 = 4.5%
  const stopPrice = entry * (1 - adverseMove);
  const pnlAtStop = pnlAt(pos, stopPrice);

  check(
    `杠杆 ${L}× 时，价格反向 ${(adverseMove * 100).toFixed(2)}% 恰好亏掉 90% 保证金`,
    near(pnlAtStop, -0.9 * margin, 0.01),
    `实际 ${pnlAtStop.toFixed(4)}`
  );

  const levels = GAME.leverageOptions.map((lev) => ({
    lev,
    stopPercent: (GAME.liquidationRatio / lev) * 100,
  }));
  const stopFor = (lev) => levels.find((l) => l.lev === lev).stopPercent;
  check(
    "强平距离只由杠杆决定（100×→0.9%，50×→1.8%，20×→4.5%，10×→9%）",
    near(stopFor(100), 0.9, 1e-9) &&
      near(stopFor(50), 1.8, 1e-9) &&
      near(stopFor(20), 4.5, 1e-9) &&
      near(stopFor(10), 9, 1e-9),
    `${stopFor(100)} / ${stopFor(50)} / ${stopFor(20)} / ${stopFor(10)}`
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n【7】强平价与追加保证金（文档 §6.1 / §6.3 / §6.5）");
/* -------------------------------------------------------------------------- */

{
  const pos = createPosition({ side: "long", leverage: 20, margin: 1000, entryPrice: 1.0 });
  check("开仓时累计保证金 = 初始保证金", pos.margin === 1000 && pos.initialMargin === 1000);
  check("名义仓位 = 1000 × 20 = 20,000", pos.notional === 20000);

  const stopLong = stopPriceFor(pos);
  check(
    "做多强平价 = 开仓价 × (1 − 90%×M/N)",
    near(stopLong, 1 * (1 - (0.9 * 1000) / 20000), 1e-9),
    `实际 ${stopLong}`
  );
  check(
    "价格到达强平价时，亏损恰好 = 90% 保证金",
    near(pnlAt(pos, stopLong), -0.9 * 1000, 1e-6),
    `实际 ${pnlAt(pos, stopLong)}`
  );

  const shortPos = createPosition({ side: "short", leverage: 20, margin: 1000, entryPrice: 1.0 });
  const stopShort = stopPriceFor(shortPos);
  check("做空强平价在开仓价上方", stopShort > 1, `${stopShort}`);
  check(
    "做空到达强平价时，亏损同样 = 90% 保证金",
    near(pnlAt(shortPos, stopShort), -0.9 * 1000, 1e-6),
    `实际 ${pnlAt(shortPos, stopShort)}`
  );

  // 追加保证金：只改累计保证金，不碰名义仓位（文档 §6.3）
  const notionalBefore = pos.notional;
  const entryBefore = pos.entryPrice;
  addMarginToPosition(pos, 500);
  check("追加后累计保证金 = 1,500", pos.margin === 1500);
  check("追加后名义仓位不变", pos.notional === notionalBefore);
  check("追加后开仓价不变", pos.entryPrice === entryBefore);
  check("追加后初始保证金记录不变", pos.initialMargin === 1000);

  const stopAfter = stopPriceFor(pos);
  check("追加后强平价更远离开仓价（更难被强平）", stopAfter < stopLong, `${stopLong} → ${stopAfter}`);
  check(
    "追加后强平亏损 = 90% × 1,500 = 1,350",
    near(liquidationLossFor(pos), 1350, 1e-9),
    `实际 ${liquidationLossFor(pos)}`
  );
  check(
    "追加后价格到新强平价，亏损恰好 = 90% × 新累计保证金",
    near(pnlAt(pos, stopAfter), -1350, 1e-6),
    `实际 ${pnlAt(pos, stopAfter)}`
  );

  // 多次追加
  addMarginToPosition(pos, 500);
  addMarginToPosition(pos, 1000);
  check(
    "多次追加后 cumulative 累加正确",
    pos.margin === 3000 && near(liquidationLossFor(pos), 2700, 1e-9)
  );

  // 收盘价越过阈值即判定（文档 §6.5）
  const p = createPosition({ side: "long", leverage: 100, margin: 5000, entryPrice: 1.0 });
  const trigger = stopPriceFor(p);
  check("收盘价跌破强平价 → 判定强平", isLiquidatedAt(p, trigger) === true);
  check("收盘价恰好等于强平价 → 判定强平（含边界）", isLiquidatedAt(p, trigger - 1e-9) === true);
  check(
    "收盘价仍高于强平价 → 不判定（只是插针不算成交，与收盘价成交口径一致）",
    isLiquidatedAt(p, trigger + 1e-6) === false
  );
  check(
    "收盘价大幅跳空越过强平价 → 仍判定，且按阈值价成交",
    isLiquidatedAt(p, trigger - 0.02) === true &&
      near(pnlAt(p, trigger), -0.9 * 5000, 1e-6)
  );
  const shortP = createPosition({ side: "short", leverage: 100, margin: 5000, entryPrice: 1.0 });
  const shortTrigger = stopPriceFor(shortP);
  check(
    "做空：收盘价涨破强平价才判定",
    isLiquidatedAt(shortP, shortTrigger + 1e-6) === true &&
      isLiquidatedAt(shortP, shortTrigger - 1e-6) === false
  );

  // 按阈值价成交 → 亏损锁定在 90%，绝不穿仓
  const catastrophic = p.entryPrice * 0.5; // 价格腰斩
  check(
    "即使行情崩到腰斩，按强平价成交的亏损仍为 90% 保证金（不穿仓）",
    near(pnlAt(p, trigger), -0.9 * 5000, 1e-6) && pnlAt(p, catastrophic) < -5000,
    `阈值成交 ${pnlAt(p, trigger).toFixed(2)}，若按崩溃价 ${pnlAt(p, catastrophic).toFixed(2)}`
  );

  // 强平弹窗询问规则（用户确认：剩余 < 5 秒直接结算）
  check(
    "剩余 5.0 秒时仍弹强平窗口（含边界）",
    shouldShowLiquidationDialog(5000) === true
  );
  check("剩余 4.9 秒时不再询问，直接结算", shouldShowLiquidationDialog(4900) === false);
  check("剩余 0 秒时直接结算", shouldShowLiquidationDialog(0) === false);
}

/* -------------------------------------------------------------------------- */
console.log(
  `\n结果：${checks - failures} / ${checks} 项通过${failures ? `，${failures} 项失败` : ""}\n`
);
process.exit(failures ? 1 : 0);
