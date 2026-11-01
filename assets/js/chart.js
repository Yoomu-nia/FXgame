/**
 * chart.js — K 线图封装（TradingView Lightweight Charts v4）
 *
 * 只负责"把数据画出来"，不含任何游戏规则。
 * 图表库以普通 <script> 引入 index.html，挂在全局 window.LightweightCharts。
 *
 * 关于"回合切换后图表错乱"的修复（两处状态必须显式重置）：
 *   1. 价格轴：强平线会用 autoscaleInfoProvider 把强平价纳入缩放范围。
 *      以前是把 provider 设成 undefined 来"取消"，但库不会真的清掉旧 provider，
 *      于是下一回合的价格轴仍在迁就上一回合的强平价 → 比例尺怪怪的。
 *      现在 provider 只挂一次，用变量 stopScalePrice 控制是否生效。
 *   2. 时间轴：同一批 K 线的时间戳每回合都一样（都是从 09:00 开始的模拟时间），
 *      库会保留上一回合的滚动位置，新回合只有 30 根数据却停在 40~60 的位置 →
 *      看起来"图表空着"。现在每次 setData 都重新贴合一次内容，
 *      并且在容器尺寸就绪后再补一次（首屏或从隐藏状态切回来时尺寸可能还是 0）。
 */

/* 图表配色（与 main.css 的设计令牌一致） */
const THEME = {
  up: "#73b99a",
  down: "#e85d75",
  text: "#5d5568",
  grid: "#f8ecf4",
  border: "#f0dfe9",
  crosshair: "#c8b6e8",
  crosshairLabel: "#a98fd6",
};

let lib = null;

function getLib() {
  if (lib) return lib;
  lib = window.LightweightCharts;
  return lib;
}

/** 图表库是否可用（离线文件没加载成功时可以给出提示） */
export function isChartAvailable() {
  return Boolean(getLib());
}

/**
 * 在容器里创建一张 K 线图。
 * @param {HTMLElement} container
 */
export function createChartView(container) {
  const LWC = getLib();
  if (!LWC) {
    throw new Error("图表库未加载：请检查 vendor/lightweight-charts-4.1.3.standalone.production.js");
  }

  const chart = LWC.createChart(container, {
    autoSize: true,
    layout: {
      background: { type: "solid", color: "#ffffff" },
      textColor: THEME.text,
      fontSize: 12,
      fontFamily: '"Cascadia Mono", "SF Mono", Consolas, ui-monospace, monospace',
    },
    grid: {
      vertLines: { color: THEME.grid },
      horzLines: { color: THEME.grid },
    },
    rightPriceScale: {
      borderColor: THEME.border,
      scaleMargins: { top: 0.14, bottom: 0.12 },
    },
    timeScale: {
      borderColor: THEME.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
      barSpacing: 9,
    },
    crosshair: {
      mode: LWC.CrosshairMode.Normal,
      vertLine: { color: THEME.crosshair, width: 1, labelBackgroundColor: THEME.crosshairLabel },
      horzLine: { color: THEME.crosshair, width: 1, labelBackgroundColor: THEME.crosshairLabel },
    },
    localization: {
      locale: "zh-CN",
    },
  });

  /** 需要纳入价格轴范围的强平价（null = 按 K 线自动缩放） */
  let stopScalePrice = null;

  /**
   * 只挂一次的自动缩放钩子：读取 stopScalePrice 决定要不要扩展价格范围。
   * 挂一次、改变量，就不会出现"旧 provider 清不掉"的问题。
   */
  const autoscaleProvider = (original) => {
    const result = original();
    if (stopScalePrice === null || !result?.priceRange) return result;
    const { minValue, maxValue } = result.priceRange;
    const pad = Math.max((maxValue - minValue) * 0.06, Math.abs(stopScalePrice) * 0.0002);
    return {
      ...result,
      priceRange: {
        minValue: Math.min(minValue, stopScalePrice - pad),
        maxValue: Math.max(maxValue, stopScalePrice + pad),
      },
    };
  };

  const series = chart.addCandlestickSeries({
    upColor: THEME.up,
    downColor: THEME.down,
    borderUpColor: THEME.up,
    borderDownColor: THEME.down,
    wickUpColor: THEME.up,
    wickDownColor: THEME.down,
    priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    autoscaleInfoProvider: autoscaleProvider,
  });

  /** 记录当前挂在图上的参考线（开仓价、强平线） */
  const priceLines = new Set();

  let barCount = 0;
  let pendingFit = true;

  /**
   * 让视窗贴合当前数据。容器还没有尺寸时直接返回 false（等 ResizeObserver 再来）。
   * @returns {boolean} 是否已成功应用
   */
  function applyFit() {
    if (!container.clientWidth || !barCount) return false;
    chart.timeScale().fitContent();
    chart.priceScale("right").applyOptions({ autoScale: true });
    return true;
  }

  /** 下一帧 + 再下一帧各试一次（首帧时布局可能还没算完） */
  function scheduleFit() {
    pendingFit = true;
    if (applyFit()) pendingFit = false;
    requestAnimationFrame(() => {
      if (!pendingFit) return;
      requestAnimationFrame(() => {
        if (pendingFit) pendingFit = !applyFit();
      });
    });
  }

  // 容器从隐藏变为可见、或窗口缩放时，如果还没成功贴合就再试一次
  const resizeObserver = new ResizeObserver(() => {
    if (pendingFit) pendingFit = !applyFit();
  });
  resizeObserver.observe(container);

  return {
    chart,
    series,

    /** 一次性设置本回合可见的全部 K 线，并重置视窗与价格轴 */
    setData(candles) {
      barCount = Array.isArray(candles) ? candles.length : 0;
      stopScalePrice = null; // 新回合先按 K 线自动缩放
      series.setData(candles);
      scheduleFit();
    },

    /** 追加/更新最后一根 K 线（揭示阶段用，不打断已贴合好的视窗） */
    update(candle) {
      barCount += 1;
      series.update(candle);
    },

    /** 手动重新贴合（切换回行情页时用） */
    fit() {
      scheduleFit();
    },

    /**
     * 让强平价进入价格轴自动缩放范围，保证红线一定画得出来。
     * 传 null 恢复默认缩放（强平价太远时不硬拉，避免把 K 线压扁）。
     */
    setStopScale(price) {
      stopScalePrice = Number.isFinite(price) ? price : null;
      // 重新挂一次同一个 provider，让库重新计算一次价格轴
      series.applyOptions({ autoscaleInfoProvider: autoscaleProvider });
    },

    /** 画一条水平参考线（开仓价、强平阈值等） */
    addPriceLine(price, options = {}) {
      const line = series.createPriceLine({
        price,
        color: "#a98fd6",
        lineWidth: 1,
        lineStyle: LWC.LineStyle.Dashed,
        axisLabelVisible: true,
        title: "",
        ...options,
      });
      priceLines.add(line);
      return line;
    },

    removePriceLine(line) {
      if (!line) return;
      series.removePriceLine(line);
      priceLines.delete(line);
    },

    /** 当前参考线数量（用于自检：平仓后应为 0） */
    priceLineCount() {
      return priceLines.size;
    },

    /** 调试/自检用：当前可视范围与柱数，确认"能看到图" */
    debugState() {
      const range = chart.timeScale().getVisibleLogicalRange();
      return {
        from: range ? Number(range.from.toFixed(2)) : null,
        to: range ? Number(range.to.toFixed(2)) : null,
        bars: barCount,
        width: container.clientWidth,
        stopScalePrice,
      };
    },

    destroy() {
      resizeObserver.disconnect();
      chart.remove();
    },
  };
}
