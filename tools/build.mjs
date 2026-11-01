/**
 * tools/build.mjs — 生成可部署的静态目录 dist/
 *
 * 这个项目本来就不需要构建：直接把 index.html / assets / vendor 拷过去就能跑。
 * 这个脚本只做一件事 —— 把"要给玩家看的文件"挑出来，
 * 免得把需求文档、开发脚本、截图一起发布到公网。
 *
 * 用法：
 *   node tools/build.mjs          # 生成 dist/
 *
 * Cloudflare Pages 里这样填：
 *   构建命令： node tools/build.mjs
 *   输出目录： dist
 */

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");

/** 需要发布到公网的内容（其余一律不进 dist） */
const INCLUDE = ["index.html", "assets", "vendor", "_headers"];

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const item of INCLUDE) {
    const from = path.join(root, item);
    if (!existsSync(from)) {
      console.warn(`跳过（不存在）：${item}`);
      continue;
    }
    const to = path.join(dist, item);
    const info = await stat(from);
    await cp(from, to, { recursive: info.isDirectory() });
    console.log(`已复制：${item}`);
  }

  console.log(`\n完成 → ${dist}`);
  console.log("把 dist/ 作为 Cloudflare Pages 的输出目录即可。");
}

main().catch((error) => {
  console.error("构建失败：", error);
  process.exit(1);
});
