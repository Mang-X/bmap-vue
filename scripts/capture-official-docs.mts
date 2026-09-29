#!/usr/bin/env node
/**
 * 抓取官方 React 文档站的 API 表（issue #141）
 *
 * ## 为什么必须用浏览器而不是 HTTP 抓取
 *
 * `https://lbs.baidu.com/jsapi/react/docs/` 是 **hash 路由**（`#/component/marker`）：
 * 服务端请求拿到的永远是站点外壳，内容由前端渲染——直接 fetch 会得到 404 或空壳，
 * **看起来像页面不存在，其实它好好地在那儿**。所以走系统 Chrome 的 CDP。
 *
 * ## 为什么要单独一个抓取脚本
 *
 * 抓取要联网、要起浏览器；比对要离线、要能反复跑。两者分开之后，
 * `compare-official-docs.mts` 可以在本地/CI 反复执行而不依赖网络。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

const ROOT = resolve(import.meta.dirname, "..");
const ART = join(ROOT, ".artifacts");
const OUT = join(ART, "official-docs.json");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function findChrome(): string {
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(
      "capture-official-docs: 找不到 Chrome。CDP 抓取需要系统浏览器；" +
        "可以改用 Playwright，或手工把页面内容存到 .artifacts/official-docs.json。",
    );
  }
  return hit;
}

const PORT = 9251;

async function main(): Promise<number> {
  // 先问比对脚本要抓哪些 slug——单一事实源，避免两处列表漂移。
  const { SLUGS, OFFICIAL_BASE } = await import("./compare-official-docs.mts").catch(() => ({
    SLUGS: {} as Record<string, string>,
    OFFICIAL_BASE: "https://lbs.baidu.com/jsapi/react/docs/#/component/",
  }));
  const urls = Object.values(SLUGS).map((s) => OFFICIAL_BASE + s);
  if (urls.length === 0) {
    console.error("capture-official-docs: SLUGS 为空，无法确定抓取清单。");
    return 1;
  }

  const profile = `/tmp/cdp-official-${Date.now()}`;
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--no-first-run",
      "--disable-gpu",
      `--user-data-dir=${profile}`,
      "--window-size=1400,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await sleep(5000);
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
      type: string;
      webSocketDebuggerUrl: string;
    }[];
    const target = list.find((t) => t.type === "page");
    if (!target) throw new Error("拿不到 CDP page target");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pend = new Map<number, (v: unknown) => void>();
    const events: { method: string; params: unknown }[] = [];
    ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string) as { id?: number; method?: string; params?: unknown };
      if (m.id && pend.has(m.id)) {
        pend.get(m.id)!(m);
        pend.delete(m.id);
      } else if (m.method) {
        events.push({ method: m.method, params: m.params });
      }
    };
    await new Promise<void>((r) => (ws.onopen = () => r()));
    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
      new Promise((res) => {
        const i = ++id;
        pend.set(i, res);
        ws.send(JSON.stringify({ id: i, method, params }));
      });

    await send("Runtime.enable");
    await send("Page.enable");

    const captured: Record<string, unknown> = {};
    for (const url of urls) {
      events.length = 0;
      await send("Page.navigate", { url });
      await sleep(2600);
      const r = (await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const main = document.querySelector('#app') || document.body;
          const tables = [...main.querySelectorAll('table')].map(t => ({
            headers: [...t.querySelectorAll('th')].map(h => h.textContent.trim()),
            rows: [...t.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.textContent.trim())),
          }));
          return {
            title: document.title,
            hash: location.hash,
            headings: [...main.querySelectorAll('h1,h2,h3')].map(h => h.textContent.trim()).slice(0, 20),
            tables,
          };
        })()`,
      })) as { result?: { result?: { value?: unknown } } };
      captured[url] = r.result?.result?.value ?? {};
    }
    ws.close();
    mkdirSync(ART, { recursive: true });
    writeFileSync(OUT, JSON.stringify(captured, null, 1));
    const withTable = Object.values(captured).filter(
      (d) => (d as { tables?: unknown[] }).tables?.length,
    ).length;
    console.log(
      `capture-official-docs: 抓取 ${urls.length} 页（${withTable} 页带 API 表）→ ${OUT}`,
    );
    if (withTable === 0) {
      console.error("一页都没抓到 API 表——多半是站点结构变了，别把空结果当「官方没有」。");
      return 1;
    }
    return 0;
  } finally {
    chrome.kill();
  }
}

process.exitCode = await main();
