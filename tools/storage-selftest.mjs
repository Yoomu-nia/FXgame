/**
 * tools/storage-selftest.mjs — 本地存档自检（阶段六）
 *
 * Node 里没有 localStorage，这里用一个内存版替身，
 * 顺便模拟"写满配额抛错""存档被写坏"这类现实情况。
 *
 * 运行：node tools/storage-selftest.mjs
 */

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

/* ---------- 内存版 localStorage ---------- */
function createMemoryStorage() {
  const map = new Map();
  return {
    failNextWrite: false,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (this.failNextWrite) {
        this.failNextWrite = false;
        throw new Error("QuotaExceededError");
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    _dump() {
      return Object.fromEntries(map);
    },
  };
}

const fakeStorage = createMemoryStorage();
globalThis.window = { localStorage: fakeStorage };

const storage = await import("../assets/js/storage.js");

/* -------------------------------------------------------------------------- */
console.log("\n【1】设置：上次的难度");
/* -------------------------------------------------------------------------- */

{
  check("没有存档时 difficultyId 为 null", storage.loadSettings().difficultyId === null);

  storage.saveSettings({ difficultyId: "extreme" });
  check("保存后能读回 extreme", storage.loadSettings().difficultyId === "extreme");

  storage.saveSettings({ difficultyId: "normal" });
  check("再次保存会覆盖", storage.loadSettings().difficultyId === "normal");

  // 模拟存档被写坏
  fakeStorage.setItem("kline-coaster:settings:v1", "{not json");
  check("存档损坏时回退为 null，不抛错", storage.loadSettings().difficultyId === null);

  fakeStorage.removeItem("kline-coaster:settings:v1");
}

/* -------------------------------------------------------------------------- */
console.log("\n【2】成绩历史：最近 10 局");
/* -------------------------------------------------------------------------- */

{
  check("初始历史为空数组", storage.loadHistory().length === 0);

  const entry = (pnl, day) => ({
    at: Date.UTC(2026, 0, day),
    difficultyId: "hard",
    reason: "rounds",
    initialBalance: 10000,
    finalBalance: 10000 + pnl,
    pnl,
    returnRate: (pnl / 10000) * 100,
    rounds: 5,
    wins: 2,
    losses: 3,
    winRate: 40,
  });

  storage.saveGame(entry(100, 1));
  storage.saveGame(entry(-50, 2));
  const history = storage.loadHistory();
  check("最新的排在最前面", history[0].pnl === -50 && history[1].pnl === 100);

  // 写满 12 局，只应保留 10 局
  for (let i = 3; i <= 12; i++) storage.saveGame(entry(i * 10, i));
  const capped = storage.loadHistory();
  check("最多只保留 10 局", capped.length === storage.MAX_HISTORY && capped.length === 10, `实际 ${capped.length}`);
  check("保留的是最新的 10 局", capped[0].pnl === 120 && capped[9].pnl === 30);

  check("非法记录被过滤掉", (() => {
    storage.saveGame({ pnl: "abc" });
    storage.saveGame(null);
    storage.saveGame({ pnl: 1, finalBalance: 1 }); // 缺 difficultyId
    return storage.loadHistory().length === 10;
  })());
}

/* -------------------------------------------------------------------------- */
console.log("\n【3】最佳一局");
/* -------------------------------------------------------------------------- */

{
  const best = storage.bestGame();
  check("在 10 局里挑出累计盈亏最高的那一局", best && best.pnl === 120, `实际 ${best?.pnl}`);
  check("空历史时最佳为 null", storage.bestGame([]) === null);

  storage.saveGame({
    at: Date.now(),
    difficultyId: "extreme",
    reason: "rounds",
    initialBalance: 10000,
    finalBalance: 18500,
    pnl: 8500,
    returnRate: 85,
    rounds: 5,
    wins: 5,
    losses: 0,
    winRate: 100,
  });
  check("新打出的更高成绩会成为最佳", storage.bestGame().pnl === 8500);
}

/* -------------------------------------------------------------------------- */
console.log("\n【4】异常情况");
/* -------------------------------------------------------------------------- */

{
  const before = storage.loadHistory().length;
  fakeStorage.failNextWrite = true;
  let threw = false;
  try {
    storage.saveGame({
      at: Date.now(),
      difficultyId: "hard",
      reason: "broke",
      initialBalance: 10000,
      finalBalance: 0,
      pnl: -10000,
      returnRate: -100,
      rounds: 3,
      wins: 0,
      losses: 3,
      winRate: 0,
    });
  } catch {
    threw = true;
  }
  check("写满配额时不抛错，游戏不崩", threw === false);
  check("写入失败后旧存档保持不变", storage.loadHistory().length === before);

  // 完全不可用的 localStorage（隐私模式）
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    },
  };
  const reloaded = await import("../assets/js/storage.js?bust=" + Date.now());
  check("localStorage 被禁用时读取返回空", reloaded.loadHistory().length === 0);
  check("localStorage 被禁用时保存不抛错", (() => {
    try {
      reloaded.saveGame({ at: 1, difficultyId: "hard", pnl: 1, finalBalance: 10001 });
      return true;
    } catch {
      return false;
    }
  })());
}

/* -------------------------------------------------------------------------- */
console.log(
  `\n结果：${checks - failures} / ${checks} 项通过${failures ? `，${failures} 项失败` : ""}\n`
);
process.exit(failures ? 1 : 0);
