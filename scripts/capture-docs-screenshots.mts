/**
 * 重拍文档站截图。
 *
 * **为什么要脚本，不能手截**：PWA manifest 与 og:image 声明的 `sizes` 必须与真实像素
 * 一致，截图尺寸是契约的一部分。手截「看着差不多」就行，但 manifest 照抄声明，
 * 两者对不上时没有任何东西会红。全部按**声明的尺寸**渲染，写盘前逐张核对实际像素。
 *
 * **主题怎么定**：VitePress 把外观存在 `localStorage['vitepress-theme-appearance']`。
 * 实测两条捷径都不成立——`--blink-settings=preferredColorScheme` 传了页面仍是浅色；
 * `--user-data-dir` 跨进程持久化在 headless 下会挂住。所以走 CDP 的
 * `Page.addScriptToEvaluateOnNewDocument`，在页面脚本**之前**于同源上下文写入，
 * VitePress 首屏读到的就是它。拍完再回读一次 `classList` 确认，主题不对直接报错，
 * 不产出错图。
 *
 * CDP 客户端用 Node 内置的 `WebSocket`（Node >= 22），写法与
 * `capture-official-docs.mts` 一致——不要自己按行解析 socket 报文，那是 WebSocket
 * **帧**不是换行分隔的文本（踩过：`Unexpected token 'H'`）。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "docs/public/screenshots");
const PORT = 9331;
const BASE = process.env.BMAP_DOCS_BASE ?? "http://localhost:5173/bmap-vue";
/** JPEG 质量。与之前 `sips -s formatOptions 82` 对齐。 */
const JPEG_QUALITY = 82;

interface Shot {
  file: string;
  url: string;
  width: number;
  height: number;
  dark: boolean;
}

const SHOT_LIST: Shot[] = [
  { file: "site-home.jpg", url: `${BASE}/`, width: 1600, height: 1000, dark: true },
  { file: "og-cover.jpg", url: `${BASE}/`, width: 1200, height: 630, dark: true },
  {
    file: "components-marker.jpg",
    url: `${BASE}/zh-CN/components/overlay/marker`,
    width: 1600,
    height: 1000,
    dark: false,
  },
];

/** 与 `render-brand-icons.mts` 同一套候选，理由见那里。 */
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
      `找不到 Chromium。设置 SMOKE_BROWSER，或 \`npx playwright install chromium\`。\n` +
        `已试：\n${candidates.join("\n")}`,
    );
  }
  return found;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForPageTarget(retries = 80): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* DevTools 还没起来 */
    }
    await sleep(250);
  }
  throw new Error(`DevTools 没在 ${PORT} 上就绪`);
}

/**
 * 端口必须空闲，否则会连到**上一次**留下的浏览器上。
 *
 * 这个坑很隐蔽：连上旧实例时代码一切正常，但那个实例是带着 `--disable-gpu`
 * 启动的，于是 JSAPI 4.0 的 WebGL 画布永远出不来，就绪判据 45s 超时——
 * 看起来像「页面有问题」，实际是「连错了浏览器」。踩过一次，留个前置检查。
 */
async function assertPortFree(): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (res.ok) {
      throw new Error(
        `${PORT} 上已经有浏览器在监听。先杀掉它再跑：\n` +
          `  pkill -f "remote-debugging-port=${PORT}"\n` +
          `连到旧实例会让本脚本的启动参数（例如软件 WebGL）静默失效。`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("已经有浏览器")) throw error;
    /* 连不上 = 端口空闲，符合预期 */
  }
}

/** 读 JPEG 尺寸：扫 SOF 标记（跳过 APPn/DQT 等，直到遇到带尺寸的那个）。 */
function jpegSize(path: string): { width: number; height: number } {
  const b = readFileSync(path);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15，排除 DHT(c4) / JPG(c8) / DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`${path}: 找不到 JPEG 的 SOF 标记，读不出尺寸`);
}

type Evaluate = (expression: string) => Promise<any>;

/**
 * 轮询到「这张图能拍」为止。
 *
 * 就绪判据按页面类型分：
 *   - **组件页**：示例里的地图必须有**画布**且画出了东西。`BMap.Map` 的容器 div
 *     从一开始就存在，宽度也立刻有值——只看它们会误判成「就绪」。判据取
 *     canvas 数量与尺寸：SDK 起来之前没有 canvas，起来之后才有。
 *   - **首页**：首屏渲染完即可（hero 是内联 SVG，没有外部资源）。
 *
 * 主题**不在这里**判：VitePress 2 的 SSR 首屏已经定好主题，本函数要等的就是
 * 那之后，主题由调用方在内容就绪后统一切换并回读校验。
 */
async function waitForContent(evaluate: Evaluate, shot: Shot): Promise<void> {
  const deadline = Date.now() + 45_000;
  let last = "";
  while (Date.now() < deadline) {
    // 导航进行中执行上下文会被销毁，这时求值返回 undefined —— 那是「还没到」，
    // 不是「失败了」。
    const value = await evaluate(`JSON.stringify((() => {
          const canvases = [...document.querySelectorAll('canvas')].filter(c => c.width > 0);
          return {
            dark: document.documentElement.classList.contains('dark'),
            // 示例容器的类名是 example-showcase（本站 vp-example.vue 的根节点），
            // 不是 VitePress 自带的 vp-example —— 用后者选永远读到 0，
            // 于是下面 canvas 明明已经就绪也被短路成「没到」。
            ready: document.querySelectorAll('.VPFeature, .vp-doc, .example-showcase').length,
            hero: (() => { const h = document.querySelector('.VPImage.image-src, .VPHomeHero img');
                          return h ? h.complete && h.naturalWidth > 0 : null; })(),
            canvas: canvases.length,
            canvasPx: canvases.reduce((n, c) => n + c.width * c.height, 0),
          };
        })())`);
    if (typeof value !== "string") {
      await sleep(300);
      continue;
    }
    const s = JSON.parse(value) as {
      dark: boolean;
      ready: number;
      hero: boolean | null;
      canvas: number;
      canvasPx: number;
    };
    if (s.dark !== shot.dark) {
      throw new Error(
        `${shot.file}: 主题不对——期望 ${shot.dark ? "深色" : "浅色"}，实际 ${s.dark ? "深色" : "浅色"}。` +
          "注入没生效，不要产出主题错误的截图。",
      );
    }
    if (s.ready === 0) {
      await sleep(250);
      continue;
    }
    if (s.hero === false) {
      await sleep(250);
      continue;
    }
    // 组件页要有画出来的地图；首页没有 canvas，两条判据分开。
    if (shot.url.includes("/zh-CN/")) {
      if (s.canvas === 0 || s.canvasPx === 0) {
        last = `canvas=${s.canvas} px=${s.canvasPx} ready=${s.ready} dark=${s.dark}`;
        await sleep(500);
        continue;
      }
    }
    // 画完再多等一拍，让瓦片请求落定。
    await sleep(1500);
    return;
  }
  throw new Error(
    `${shot.file}: 45s 内没等到可拍状态（${last || "内容未渲染"}）。` +
      "组件页要真地图，示例需要 AK 且能访问 api.map.baidu.com。\n" +
      "排查提示：示例容器在本站的类名是 example-showcase，不是 vp-example；" +
      "就绪判据里如果按后者选，会一直读到 0。",
  );
}

await assertPortFree();

const chrome = spawn(
  findChrome(),
  [
    "--headless",
    // **不能**用 `--disable-gpu`：JSAPI 4.0 是 WebGL 渲染，禁用 GPU 后地图示例
    // 永远建不出 canvas，于是 `waitForReady` 45s 超时。改走 SwiftShader 软件光栅化
    // （实测：canvas 正常出现，尺寸与真实浏览器一致）。
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  const wsUrl = await waitForPageTarget();
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map<number, (v: any) => void>();
  ws.onmessage = (e: MessageEvent) => {
    const m = JSON.parse(e.data as string) as { id?: number };
    if (m.id !== undefined) {
      pend.get(m.id)?.(m);
      pend.delete(m.id);
    }
  };
  await new Promise<void>((r) => (ws.onopen = () => r()));

  /**
   * CDP 的回复是 `{ id, result: { result: { value } } }` —— **两层** result。
   * 这里返回整条消息，调用方按 `msg.result.result.value` 取值。
   *
   * 踩过的坑：早先只回了 `m.result`，于是取值写成 `r.result.value`，
   * 永远拿到 undefined；页面偶尔"碰巧"对，是因为系统深色模式恰好是深色，
   * 不是注入起了作用。判断一个脚本有没有生效，不能只看结果碰巧对。
   */
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
    new Promise((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pend.delete(i);
        rej(new Error(`CDP ${method} 超时（10s）`));
      }, 10_000);
      pend.set(i, (msg: any) => {
        clearTimeout(timer);
        res(msg);
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  /** 求值并取回原始值；上下文销毁时返回 undefined 而不是抛。 */
  const evaluate = async (expression: string): Promise<any> => {
    try {
      const msg = await send("Runtime.evaluate", { returnByValue: true, expression });
      return msg?.result?.result?.value;
    } catch {
      return undefined;
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");

  let appearanceScriptId: string | undefined;

  for (const shot of SHOT_LIST) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // 主题必须在**导航之前**写好。VitePress 2 用 `@vueuse/core` 的 `useDark`
    // （storageKey 就是 `vitepress-theme-appearance`），首屏同步读它；
    // 导航之后再改只能等下一次渲染，截图会拍到系统当前模式。
    //
    // `addScriptToEvaluateOnNewDocument` 是**累积**的：每轮都追加一条的话，
    // 第二张图会同时执行 dark 与 light 两条，后注册的覆盖先注册的。
    // 所以每轮先移除上一条（踩过一次：期望深色，拍到浅色）。
    if (appearanceScriptId !== undefined) {
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: appearanceScriptId });
    }
    const injected = (await send("Page.addScriptToEvaluateOnNewDocument", {
      // 单行、无换行。注入脚本是当**一个** script 元素求值的，拼成多行时
      // 换行落在 `try{` 与语句之间会让整段解析失败——症状是「没报错但也没生效」，
      // 很容易被误判成 CDP 的问题。这里用模板串一次拼完，不跨行。
      source: `try{localStorage.setItem('vitepress-theme-appearance','${shot.dark ? "dark" : "light"}')}catch(e){};`,
    })) as { result: { identifier: string } };
    appearanceScriptId = injected.result.identifier;

    // 先 about:blank 再回目标页：同 URL 连拍两张（首页的 1600×1000 与 1200×630）
    // 时 `Page.navigate` 到同一地址不会重新导航，注入的脚本也就不会重跑，
    // 主题停在上一张。绕一圈强制一次真实导航。
    await send("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await send("Page.navigate", { url: shot.url });
    // 轮询到「真的能拍」为止，而不是死等一个拍脑袋的秒数：
    // 组件页要把 JSAPI 4.0 整个拉起来（外网），首页只是首屏渲染，两者的就绪时刻
    // 差一个数量级。固定 sleep 会拍出半张图——第一次就是这么拍出一张 GitHub 图标
    // 报错页当「组件示例」。
    await waitForContent(evaluate, shot);

    // 直接让 CDP 出 JPEG：`Page.captureScreenshot` 原生支持
    // `{format: "jpeg", quality: N}`，不必先拍 PNG 再转。
    //
    // 早先这里拍 PNG 再调 macOS 的 `sips` 转 JPEG——那是**隐式的 macOS-only**：
    // CONTRIBUTING 与 AGENTS 只声明「需要本地站点 + Chromium」，Linux 与 Windows
    // 上会在三张图全部拍完之后才必然失败。实测 CDP 直出 JPEG（magic `ffd8ff`），
    // 平台依赖就此去掉。
    //
    // 同样两层 result：截图数据在 `msg.result.data`。
    const shotMsg = (await send("Page.captureScreenshot", {
      format: "jpeg",
      quality: JPEG_QUALITY,
    })) as { result: { data: string } };
    const jpeg = Buffer.from(shotMsg.result.data, "base64");
    if (jpeg.subarray(0, 3).toString("hex") !== "ffd8ff") {
      throw new Error(
        `${shot.file}: CDP 返回的不是 JPEG（magic=${jpeg.subarray(0, 3).toString("hex")}）`,
      );
    }
    const target = join(SHOTS, shot.file);
    writeFileSync(target, jpeg);
    // 写盘后再从**文件**读回来校验：内存里的 Buffer 尺寸对了不代表落盘对了，
    // 而 manifest 消费的是文件。
    const got = jpegSize(target);
    if (got.width !== shot.width || got.height !== shot.height) {
      throw new Error(
        `${shot.file}: 实际 ${got.width}×${got.height}，需要 ${shot.width}×${shot.height}——` +
          `manifest 的 sizes 照抄这里。`,
      );
    }
    process.stdout.write(`  docs/public/screenshots/${shot.file}  ${got.width}×${got.height}\n`);
  }

  ws.close();

  process.stdout.write(
    `已重拍 ${SHOT_LIST.length} 张截图 → docs/public/screenshots/*.jpg\n` +
      `主题与渲染完成度逐张回读校验，尺寸与 manifest 声明一致。\n`,
  );
} finally {
  chrome.kill();
}
