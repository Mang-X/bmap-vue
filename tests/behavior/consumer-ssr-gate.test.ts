/**
 * SSR 消费者门禁的自测（issue #158 工作包 B）
 *
 * 真实编译 + renderToString 由 `pnpm verify:package` 在 CI 里对着**装出来的 tarball**跑
 * （它要 `build:package` 出 `dist/` 再 pack，而 `dist/` 是并行用例读的对象，本目录下
 * `dts-strict-gate.test.ts` 记着同一个坑）。这里守三件事：
 *
 * 1. **接线**：`verify:package` 真的调了 SSR 驱动脚本，并把它指向消费 fixture；
 *    CI 不另起第二处。新增门禁最典型的失效方式是「写了但没跑」。
 * 2. **取证是真的**：fixture 的 `App.vue` 必须是**真 SFC**（不是 `h(Map)` 手搓），
 *    `@vue/server-renderer` 必须**显式声明**，runner 必须跑在纯 Node（不得出现
 *    happy-dom / jsdom），且必须扣掉 Vue 自身的 DOM 探测基线 —— 否则「增量 0」不成立。
 * 3. **判据有牙**：`assertSsrReport` 对每一类违规都必须抛错（合成报告逐个喂）。
 *    只验「合法报告能过」的话，把判据改成恒真也照样绿。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSsrReport, type SsrReport } from "../../scripts/consumer-ssr-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");
const RUNNER = resolve(ROOT, "fixtures/consumer/ssr/ssr-runner.mjs");
const APP = resolve(ROOT, "fixtures/consumer/ssr/App.vue");
const CONSUMER_MANIFEST = resolve(ROOT, "fixtures/consumer/package.json");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * 剥掉注释再查内容。
 *
 * 这两个 fixture **合法地**在注释里讨论被禁止的形态（App.vue 的注释解释「为什么不是
 * `h(Map)` 手搓」，runner 的注释写明「不得加载 happy-dom / jsdom」）。按全文查会假红 ——
 * 判据要落在**代码**上，而不是「文件里提没提到这个词」。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** 一份合法报告：与真实 runner 的输出同形。 */
function validReport(): SsrReport {
  return {
    versions: { vue: "3.5.43", serverRenderer: "3.5.43", compilerSfc: "3.5.43" },
    environment: { hasWindow: false, hasDocument: false },
    domAccessDelta: [],
    html:
      '<div id="v-0" class="bmap-container"><div class="bmap-canvas-host"></div>' +
      '<span class="ssr-status">idle</span><span class="ssr-has-map">no-map</span></div>',
    loaderStatus: "notload",
    bmapGlobal: "undefined",
  };
}

describe("SSR 门禁：接线", () => {
  it("verify:package 调的是同一个 SSR 实现，并指向消费 fixture", () => {
    const source = read(VERIFY);
    expect(source, "verify-package.mts 没有调用 SSR 门禁").toContain("consumer-ssr.mts");
    expect(source, "SSR 门禁没有拿到消费 fixture 目录").toContain(
      "consumer-ssr.mts'))} ${JSON.stringify(consumerFixture)}",
    );
  });

  it("CI 的 package job 仍然只经 verify:package 这一个入口", () => {
    const workflow = readWorkflow("quality.yml");
    expect(stepBlockContaining(workflow, "verify:package").length).toBeGreaterThan(0);
    expect(workflow, "CI 里出现了 SSR 脚本的第二处调用").not.toContain("consumer-ssr.mts");
  });
});

describe("SSR 门禁：取证是真的", () => {
  it("@vue/server-renderer 在消费 fixture 里**显式声明**（不是靠 vue 的传递依赖）", () => {
    const manifest = JSON.parse(read(CONSUMER_MANIFEST)) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const declared = { ...manifest.dependencies, ...manifest.devDependencies }["@vue/server-renderer"];
    expect(
      declared,
      "fixture 没有显式声明 @vue/server-renderer —— SSR 用例会靠 vue 的传递依赖碰运气",
    ).toBeTruthy();
  });

  it("App.vue 是**真 SFC**（template + 默认插槽），不是 h(Map) 手搓", () => {
    const source = read(APP);
    expect(source, "App.vue 没有 <template> —— 那不是真 SFC").toContain("<template>");
    expect(source, "App.vue 没有 import Map").toMatch(/import\s*\{\s*Map\s*\}/);
    const code = stripComments(source);
    expect(code, "App.vue 用了渲染函数 h() —— 那绕开了「经真实 SFC 编译」这条判据").not.toMatch(
      /\bh\(/,
    );
    // 两个可观察量必须在模板里：状态与「服务端没有建图」。
    expect(source).toContain("ssr-status");
    expect(source).toContain("no-map");
  });

  it("runner 跑在纯 Node：不出现 happy-dom / jsdom，且是 .mjs", () => {
    const code = stripComments(read(RUNNER));
    expect(code, "runner 引用了 happy-dom").not.toContain("happy-dom");
    expect(code, "runner 引用了 jsdom").not.toContain("jsdom");
    expect(code, "runner 没有编译 SFC（缺 @vue/compiler-sfc）").toContain("@vue/compiler-sfc");
    expect(code, "runner 没有 renderToString").toContain("renderToString");
  });

  it("runner 扣掉了 Vue 自身的 DOM 探测基线（否则「增量 0」不成立）", () => {
    const source = read(RUNNER);
    // Vue 在 createSSRApp 时才读 window.__VUE_DEVTOOLS_GLOBAL_HOOK__，所以基线必须包含一次最小渲染。
    expect(source, "runner 没有做基线渲染 —— devtools hook 的 window 访问会算进增量").toMatch(
      /renderToString\(createSSRApp\(\{\s*render:/,
    );
    expect(source, "runner 没有按基线切增量").toContain("domAccesses.slice(baseline)");
  });

  it("runner 的 DOM 记账只看 window / document（Node 自带 navigator，不是 DOM 证据）", () => {
    const source = read(RUNNER);
    const arrayMatch = /for \(const name of \[([^\]]*)\]\)/.exec(source)?.[1];
    expect(arrayMatch, "找不到记账的全局名单").toBeTruthy();
    expect(arrayMatch!, "记账名单里混进了 navigator").not.toContain("navigator");
    expect(arrayMatch!).toContain('"document"');
    expect(arrayMatch!).toContain('"window"');
  });
});

describe("SSR 门禁：判据有牙（合成报告逐个喂）", () => {
  it("合法报告必须通过（避免判据恒假）", () => {
    expect(() => assertSsrReport(validReport())).not.toThrow();
  });

  it.each([
    ["环境里存在 window", (r: SsrReport) => ({ ...r, environment: { ...r.environment, hasWindow: true } })],
    ["环境里存在 document", (r: SsrReport) => ({ ...r, environment: { ...r.environment, hasDocument: true } })],
    [
      "三个 Vue 包版本不一致",
      (r: SsrReport) => ({ ...r, versions: { ...r.versions, serverRenderer: "3.4.0" } }),
    ],
    [
      "版本读数缺失",
      (r: SsrReport) => ({ ...r, versions: { ...r.versions, compilerSfc: "" } }),
    ],
    ["缺容器类名", (r: SsrReport) => ({ ...r, html: r.html.replace("bmap-container", "x") })],
    ["缺 canvas host", (r: SsrReport) => ({ ...r, html: r.html.replace("bmap-canvas-host", "x") })],
    [
      "状态不是 idle（服务端进入了建图状态）",
      (r: SsrReport) => ({ ...r, html: r.html.replace("ssr-status\">idle<", "ssr-status\">loading<") }),
    ],
    [
      "服务端拿到了地图实例",
      (r: SsrReport) => ({ ...r, html: r.html.replace("ssr-has-map\">no-map<", "ssr-has-map\">map<") }),
    ],
    [
      "渲染期间访问了 document",
      (r: SsrReport) => ({ ...r, domAccessDelta: ["document"] }),
    ],
    ["渲染期间访问了 window", (r: SsrReport) => ({ ...r, domAccessDelta: ["window"] })],
    ["服务端加载了 SDK（loader 状态变了）", (r: SsrReport) => ({ ...r, loaderStatus: "complete" })],
    ["服务端出现了全局 BMap", (r: SsrReport) => ({ ...r, bmapGlobal: "object" })],
    [
      "SSR 输出里注入了 script",
      (r: SsrReport) => ({ ...r, html: `${r.html}<script src="x"></script>` }),
    ],
  ])("违规必须判红：%s", (_label, mutate) => {
    expect(() => assertSsrReport(mutate(validReport()))).toThrow();
  });
});
