/**
 * `./ui-kit` 的 SSR / 无 DOM 契约（R25-D / issue #73）
 *
 * 对应 issue 验收「SSR import 与 hydration host 无副作用冲突」，以及 ADR 2026-09-13 的
 * 已知限制「UI Kit 在无 DOM 环境下 import 即失败 ⇒ `./ui-kit` 只能动态 import」。
 *
 * 做法是在**真的没有 DOM 的 Node 子进程**里跑，并把 `document` / `window` / `navigator`
 * 换成会记账的访问器 —— 这样「入口模块顶层不碰 DOM」是**可被证伪**的结论，而不是「碰巧没报错」。
 *
 * 记账必须扣掉基线：`vue` 自己在模块求值期就会探测 `document` / `window`
 * （`typeof document !== "undefined" ? document : null` 这类），那是上游行为，与本入口无关。
 * 因此每个用例先 `import("vue")` 记录基线，再 import 被测入口，只对**增量**下断言。
 *
 * 三条结论缺一不可：
 * 1. 入口 import 成功，且相对基线的 DOM 访问增量为 0；
 * 2. `loadUiKit()` 在无 DOM 时以 `BMAP_UI_KIT_UNAVAILABLE` 拒绝，且不缓存失败；
 * 3. **负向对照**：同一环境里直接 import 上游包必定在求值期崩溃 —— 否则第 1 条毫无意义
 *    （可能是上游本来就能在无 DOM 下工作）。这一条刻意**不**装访问器，让 `document` 真的不存在，
 *    以便把根因钉在 `ReferenceError: document is not defined` 上。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const distUiKit = join(repoRoot, "packages/baidu-map-gl-vue/dist/ui-kit.mjs");

interface SsrReport {
  baselineAccesses: number;
  domAccesses: string[];
  exportNames: string[];
  loadError?: { name: string; code?: unknown; message: string };
  loadResolved?: boolean;
  isLoadedAfterFailure?: boolean;
  upstreamError?: { name: string; message: string; code?: unknown };
  upstreamResolved?: boolean;
}

/** 在无 DOM 的 Node 子进程里跑一段脚本，回传结构化报告。 */
function runSsrProbe(body: string): SsrReport {
  const source = `
    const accesses = [];
    for (const name of ["document", "window", "navigator"]) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          accesses.push(name);
          return undefined;
        },
      });
    }
    // 基线：vue 自身的无 DOM 模块求值访问与本入口无关，先让它发生再记账。
    await import("vue");
    const report = { baselineAccesses: accesses.length, domAccesses: accesses };
    ${body}
    console.log(JSON.stringify(report));
  `;
  return runNode(source);
}

/** 负向对照用：不装访问器，`document` 真的不存在。 */
function runBareSsrProbe(body: string): SsrReport {
  const source = `
    const report = { baselineAccesses: 0, domAccesses: [], exportNames: [] };
    ${body}
    console.log(JSON.stringify(report));
  `;
  return runNode(source);
}

function runNode(source: string): SsrReport {
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `${source}\n`.replaceAll("__ENTRY__", JSON.stringify(distUiKit))],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output.trim().split("\n").at(-1)!) as SsrReport;
}

/** 相对基线的 DOM 访问增量。 */
function domDelta(report: SsrReport): string[] {
  return report.domAccesses.slice(report.baselineAccesses);
}

describe("无 DOM 环境下的 ./ui-kit", () => {
  it("产物存在（本用例依赖 pnpm build:v3 的产出）", () => {
    expect(existsSync(distUiKit)).toBe(true);
  });

  it("入口可以在无 DOM 的进程里 import，且模块求值期一次都没碰过 DOM", () => {
    const report = runSsrProbe(`
      const mod = await import(__ENTRY__);
      report.exportNames = Object.keys(mod).sort();
    `);
    expect(report.exportNames).toEqual(
      [
        "BPlaceAutocomplete",
        "BPlaceSearch",
        "UI_KIT_PACKAGE",
        "UI_KIT_STYLE_PATH",
        "isUiKitLoaded",
        "loadUiKit",
        "useUiKitWidget",
      ].sort(),
    );
    // 正证守卫：基线确实记到了 vue 的探测（否则记账器可能整体失效，本条就成了空转）。
    expect(report.baselineAccesses).toBeGreaterThan(0);
    expect(domDelta(report)).toEqual([]);
  });

  it("无 DOM 时 loadUiKit() 明确拒绝，且失败不被缓存", () => {
    const report = runSsrProbe(`
      const mod = await import(__ENTRY__);
      try {
        await mod.loadUiKit();
        report.loadResolved = true;
      } catch (error) {
        report.loadError = {
          name: error?.name,
          code: error?.code,
          message: String(error?.message ?? error),
        };
      }
      report.isLoadedAfterFailure = mod.isUiKitLoaded();
    `);
    expect(report.loadResolved).toBeUndefined();
    expect(report.loadError?.name).toBe("BMapError");
    expect(report.loadError?.code).toBe("BMAP_UI_KIT_UNAVAILABLE");
    expect(report.loadError?.message).toContain("只能在浏览器环境使用");
    // 拒绝之后不能把「已加载」标成 true；否则装了包重试也不会再加载。
    expect(report.isLoadedAfterFailure).toBe(false);
    // 只允许守卫自身读一次 document 探测，没有别的地方偷偷访问。
    expect(domDelta(report)).toEqual(["document"]);
  });

  it("负向对照：无 DOM 时直接 import 上游 UI Kit 必崩（所以上面那条不是空转）", () => {
    const report = runBareSsrProbe(`
      try {
        await import("@baidumap/jsapi-ui-kit");
        report.upstreamResolved = true;
      } catch (error) {
        report.upstreamError = {
          name: error?.constructor?.name,
          message: String(error?.message ?? error),
          code: typeof error?.code === "string" ? error.code : null,
        };
      }
    `);
    expect(report.upstreamResolved).toBeUndefined();
    expect(report.upstreamError).toBeDefined();
    // 上游 `main` 指向 IIFE 产物，模块求值期就撞 document。
    expect(report.upstreamError!.message).toContain("document is not defined");
    // 解析类失败（找不到模块）不能算作「上游在无 DOM 下不可用」的证据。
    expect(report.upstreamError!.code).toBeNull();
  });
});
