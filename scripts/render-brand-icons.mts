/**
 * 从正式品牌矢量资产渲染 PWA / favicon 用的光栅图标。
 *
 * 为什么不直接用 `~/Public` 里已经导好的 PNG：那些是设计交付物（含「基于百度地图的 Vue 组件库」
 * 中文字标），导航栏与 favicon 只需要图形部分；而且尺寸是 1530×1398 的非方形，
 * 直接塞进 `purpose: "any"` 的方形槽会被拉伸。
 *
 * **maskable 必须另做**：Android 会按目标形状裁切，安全区是中心 80% 的圆，
 * 所以那一版把图形缩到 62% 并换成白底（红底上红色的图钉会糊成一片色块）。
 *
 * 依赖 Chromium。渲染不出来就**报错**，不要静默跳过——缺图标的 PWA manifest
 * 是能装但没有图标的，那属于发布缺陷。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SVG = join(ROOT, "docs/public/brand/bmap-vue-icon-square.svg");
const OUT_DIR = join(ROOT, "docs/public/icons");

/**
 * 找 Chromium。口径与 `probe-plugin-load-channel.mts` 的 `resolveBrowser()` 对齐：
 * 先看 `SMOKE_BROWSER`，再扫 Playwright 缓存（CI 上常常只有它），最后看系统路径。
 *
 * `chrome-headless-shell` 与完整 Chromium 都支持 `--screenshot`（实测过，不是推测）。
 * 需要调试端口的脚本不能因此改用本函数——headless shell 只走 CDP。
 */
function findChrome(): string {
  const explicit = process.env.SMOKE_BROWSER;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`SMOKE_BROWSER 不存在：${explicit}`);
    return explicit;
  }
  const candidates: string[] = [];
  for (const root of [
    join(homedir(), "Library/Caches/ms-playwright"),
    join(homedir(), ".cache/ms-playwright"),
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? "",
  ]) {
    if (!root || !existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const base = join(root, entry);
      candidates.push(
        join(base, "chrome-headless-shell-mac-arm64/chrome-headless-shell"),
        join(base, "chrome-headless-shell-mac-x64/chrome-headless-shell"),
        join(base, "chrome-linux/chrome-headless-shell"),
        join(base, "chrome-linux/chrome"),
        join(base, "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"),
        join(base, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
      );
    }
  }
  candidates.push(
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `找不到可用的 Chromium 来渲染品牌图标。试过：\n${candidates.join("\n")}\n` +
        `设置 SMOKE_BROWSER，或 \`npx playwright install chromium\`。\n` +
        `图标必须由 ${ICON_SVG} 生成——手工维护栅格副本会和矢量资产漂移。`,
    );
  }
  return found;
}

/**
 * 把 SVG 包进固定尺寸的页面，交给 Chrome 截图。
 *
 * `content` 是 `<svg>` 自身要占的比例：必须走 CSS，不能改 width/height 属性——
 * 页面里的 `svg{width:100%}` 会盖掉呈现属性，改属性等于没改（这个坑真的踩过一次：
 * maskable 图标渲染出来和 any 版一模一样，图形顶到边，Android 裁切会切掉图钉尖）。
 */
function render(svg: string, size: number, outFile: string, background: string, content = 100): void {
  const work = join(tmpdir(), `bmap-brand-${size}-${background.slice(1)}-${content}.html`);
  writeFileSync(
    work,
    `<!doctype html><meta charset="utf-8">` +
      `<style>html,body{margin:0;padding:0;background:${background}}` +
      `div{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center}` +
      `svg{width:${content}%;height:${content}%;display:block}</style><div>${svg}</div>`,
  );
  execFileSync(
    findChrome(),
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--screenshot=${outFile}`,
      `--window-size=${size},${size}`,
      `file://${work}`,
    ],
    { stdio: "ignore" },
  );
  rmSync(work, { force: true });
  if (!existsSync(outFile)) throw new Error(`渲染失败：${outFile} 未生成`);
}

if (!existsSync(ICON_SVG)) {
  throw new Error(`品牌图标源不存在：${ICON_SVG}`);
}

const svg = readFileSync(ICON_SVG, "utf8")
  .replace(/<\?xml[^>]*\?>/, "")
  .replace(/<!DOCTYPE[^>]*>/, "");

mkdirSync(OUT_DIR, { recursive: true });

/** `any`：透明底，图形占满。 */
render(svg, 192, join(OUT_DIR, "icon-192x192.png"), "transparent");
render(svg, 512, join(OUT_DIR, "icon-512x512.png"), "transparent");

/**
 * `maskable`：**白底** + 缩到安全区内的图形。
 *
 * 缩到 62% 让图形落在中心 80% 圆内——Android 裁切时不会切到图钉尖。
 * 底色用白而不是品牌红：图钉本身就是红橙渐变，红底上红色部分直接糊成一片，
 * 圆形裁切后只剩一个看不出是什么的色块。
 */
render(svg, 512, join(OUT_DIR, "maskable-icon-512x512.png"), "#ffffff", 62);

process.stdout.write(
  `已从 ${ICON_SVG} 渲染 PWA 图标 → docs/public/icons/\n` +
    `  icon-192x192.png / icon-512x512.png（透明底）\n` +
    `  maskable-icon-512x512.png（白底，图形在安全区内）\n`,
);
