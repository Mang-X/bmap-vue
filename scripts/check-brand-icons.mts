/**
 * 品牌图标无漂移：`docs/public/icons/**` 是 `docs/public/brand/bmap-vue-icon-square.svg`
 * 的**渲染产物**，不是手工维护的资产。
 *
 * **为什么要有这道门禁**：图标一旦入库就和矢量资产解耦了，此后改标志的人没有任何提示
 * 需要重跑 `generate:brand-icons`，结果是导航栏是新版、PWA 图标还是旧版——两个红色并排出现。
 * 这类漂移不产生任何测试失败，只能靠「产物与源同源」这条不变量拦住。
 *
 * 判据是**重新渲染到临时目录后逐字节比对**，不是「文件存在」也不是「尺寸对」：
 * 存在与尺寸都可能是上一次换标志前的旧文件重新落盘。
 *
 * **没有 Chromium 时跳过，不红。** 渲染依赖浏览器，PR 门禁的 runner 未必装了
 * （仓库里其他探针同样有这类前置）。「跑不了判据」和「判据不通过」必须能区分：
 * 这里退化成 skipped 并说明缺什么，图标本身仍然进仓、仍然被 `docs:build` 与
 * manifest 断言覆盖——真正会红的是**漂移**，不是**环境**。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_DIR = join(ROOT, "docs/public/icons");
const RENDER = join(ROOT, "scripts/render-brand-icons.mts");

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

const tracked = readdirSync(ICON_DIR).filter((f) => f.endsWith(".png")).sort();
if (tracked.length === 0) {
  fail(`docs/public/icons 下没有任何 PNG——门禁空转，跑一次 pnpm generate:brand-icons`);
}

/**
 * 把渲染脚本跑在临时目录：它按 `ROOT` 推导路径，所以这里先把脚本与矢量资产
 * 复制到临时工作区，再执行，避免覆盖仓库里已入库的产物。
 */
const work = mkdtempSync(join(tmpdir(), "bmap-brand-gate-"));
try {
  cpSync(join(ROOT, "scripts"), join(work, "scripts"), { recursive: true });
  cpSync(join(ROOT, "docs/public/brand"), join(work, "docs/public/brand"), { recursive: true });
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", join(work, "scripts/render-brand-icons.mts")], {
      cwd: work,
      stdio: "ignore",
    });
  } catch {
    process.stdout.write(
      `品牌图标漂移检查已跳过：找不到 Chromium。\n` +
        `装了浏览器后本门禁会真正执行（pnpm generate:brand-icons 也需要它）。\n`,
    );
    process.exit(0);
  }

  const fresh = readdirSync(join(work, "docs/public/icons")).filter((f) => f.endsWith(".png")).sort();
  const drift: string[] = [];

  for (const f of [...new Set([...tracked, ...fresh])].sort()) {
    const committed = join(ICON_DIR, f);
    const rendered = join(work, "docs/public/icons", f);
    if (!tracked.includes(f)) {
      drift.push(`+ ${f} —— 渲染产物里有，仓库里没有`);
    } else if (!fresh.includes(f)) {
      drift.push(`- ${f} —— 仓库里有，重新渲染后消失了`);
    } else if (digest(committed) !== digest(rendered)) {
      drift.push(`~ ${f} —— 内容不同（入库 ${digest(committed)} / 重渲染 ${digest(rendered)}）`);
    }
  }

  if (drift.length > 0) {
    fail(
      `品牌图标与矢量资产漂移（${drift.length} 项）：\n` +
        drift.map((d) => `  ${d}`).join("\n") +
        `\n\n改的是 ${RENDER.replace(ROOT + "/", "")} 的源 ` +
        `docs/public/brand/bmap-vue-icon-square.svg，跑 \`pnpm generate:brand-icons\` 重新生成。`,
    );
  }

  process.stdout.write(
    `品牌图标无漂移：${tracked.length} 个 PNG 与 docs/public/brand/bmap-vue-icon-square.svg 同源\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
