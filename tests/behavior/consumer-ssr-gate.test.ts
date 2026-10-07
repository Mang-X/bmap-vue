/**
 * SSR 消费者门禁的自测（issue #158 工作包 B）
 *
 * 真实编译 + renderToString 由 `pnpm verify:package` 在 CI 里对着**装出来的 tarball**跑
 * （它要 `build:package` 出 `dist/` 再 pack，而 `dist/` 是并行用例读的对象，本目录下
 * `dts-strict-gate.test.ts` 记着同一个坑）。这里守四件事：
 *
 * 1. **接线**：`verify:package` 真的调了 SSR 驱动脚本并指向消费 fixture；CI 不另起第二处。
 * 2. **两遍取证分得开**（#206 评审 P1）：`bare` 一遍不注入任何全局，`instrument` 一遍才装
 *    getter。顺序与「不预加载 `@vueuse/core`」都由源码形状钉住 —— 它们是取证可信度本身。
 * 3. **判据说明与实现不漂移**：boundary 里不许再把 `navigator` 写进「都不许被碰」。
 * 4. **判据有牙**：两个 assert 对每一类违规都必须抛错（合成报告逐个喂）。只验「合法报告
 *    能过」的话，把判据改成恒真也照样绿。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertBareSsrReport,
  assertInstrumentedSsrReport,
  type SsrEnvironment,
  type SsrReport,
} from "../../scripts/consumer-ssr-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");
const DRIVER = resolve(ROOT, "scripts/consumer-ssr.mts");
const BOUNDARY = resolve(ROOT, "scripts/consumer-ssr-boundary.mts");
const RUNNER = resolve(ROOT, "fixtures/consumer/ssr/ssr-runner.mjs");
const APP = resolve(ROOT, "fixtures/consumer/ssr/App.vue");
const CONSUMER_MANIFEST = resolve(ROOT, "fixtures/consumer/package.json");

const HTML =
  '<div id="v-0" class="bmap-container"><div class="bmap-canvas-host"></div>' +
  '<span class="ssr-status">idle</span><span class="ssr-has-map">no-map</span></div>';

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * 剥掉注释再查内容。
 *
 * 这些 fixture **合法地**在注释里讨论被禁止的形态（runner 的注释写明「不得加载
 * happy-dom / jsdom」「不预加载 @vueuse/core」，boundary 的注释解释 `navigator` 为何不记账）。
 * 按全文查会假红 —— 判据要落在**代码**上，而不是「文件里提没提到这个词」。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** 真实 Node 的干净环境：六条证据都指向「这个全局不存在」。 */
function cleanEnvironment(): SsrEnvironment {
  return {
    typeofWindow: "undefined",
    typeofDocument: "undefined",
    windowIn: false,
    documentIn: false,
    windowOwn: false,
    documentOwn: false,
  };
}

function bareReport(): SsrReport {
  return {
    mode: "bare",
    versions: { vue: "3.5.43", serverRenderer: "3.5.43", compilerSfc: "3.5.43" },
    environmentBefore: cleanEnvironment(),
    environmentAfter: cleanEnvironment(),
    importPhase: [],
    renderPhase: [],
    html: HTML,
    loaderStatus: "notload",
    bmapGlobal: "undefined",
  };
}

function instrumentedReport(): SsrReport {
  return {
    mode: "instrument",
    versions: { vue: "3.5.43", serverRenderer: "3.5.43", compilerSfc: "3.5.43" },
    environmentBefore: cleanEnvironment(),
    // 注入 getter 之后 `in` / `hasOwn` 会变成 true —— 判据只看注入**前**的环境，
    // 这也是「为什么必须分两遍」的直接体现。
    environmentAfter: { ...cleanEnvironment(), windowIn: true, documentIn: true, windowOwn: true, documentOwn: true },
    // `@vueuse/shared` 在模块求值期做守卫式 `typeof window` —— 允许，但必须留痕。
    importPhase: ["window"],
    renderPhase: [],
    html: HTML,
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

  it("驱动脚本跑 bare 与 instrument 两遍，且判据分开", () => {
    const code = stripComments(read(DRIVER));
    expect(code, "驱动没有 bare 模式").toContain('"bare"');
    expect(code, "驱动没有 instrument 模式").toContain('"instrument"');
    expect(code, "驱动没有调用 bare 判据").toContain("assertBareSsrReport");
    expect(code, "驱动没有调用 instrument 判据").toContain("assertInstrumentedSsrReport");
  });

  it("CI 的 package job 仍然只经 verify:package 这一个入口", () => {
    const workflow = readWorkflow("quality.yml");
    expect(stepBlockContaining(workflow, "verify:package").length).toBeGreaterThan(0);
    expect(workflow, "CI 里出现了 SSR 脚本的第二处调用").not.toContain("consumer-ssr.mts");
  });
});

describe("SSR 门禁：两遍取证分得开（#206 评审 P1）", () => {
  it("runner 先取证环境，再装 getter（顺序反了 bare 就不成立）", () => {
    const code = stripComments(read(RUNNER));
    const captureAt = code.indexOf("const environmentBefore = captureEnvironment()");
    const defineAt = code.indexOf("Object.defineProperty(globalThis, name");
    expect(captureAt, "runner 没有在装 getter 前取证环境").toBeGreaterThan(0);
    expect(defineAt, "runner 没有装记账 getter").toBeGreaterThan(0);
    expect(captureAt, "取证发生在装 getter 之后 —— bare 那一遍的环境就不再是纯 Node").toBeLessThan(
      defineAt,
    );
    // 环境证据必须含 `in` / `hasOwn`：只看 `typeof` 区分不出「注入了一个返回 undefined 的 getter」。
    for (const probe of ["windowIn", "documentIn", "windowOwn", "documentOwn"]) {
      expect(code, `环境证据缺 ${probe}`).toContain(probe);
    }
  });

  it("getter 只在 instrument 模式装（bare 一个全局都不碰）", () => {
    const code = stripComments(read(RUNNER));
    expect(code, "记账 getter 的安装没有按模式分支").toMatch(
      /if \(mode === "instrument"\) \{\s*for \(const name of/,
    );
  });

  it("runner **不预加载** @vueuse/core（让它随真实 import closure 首次求值）", () => {
    const code = stripComments(read(RUNNER));
    expect(
      code,
      "runner 预加载了 @vueuse/core —— 它的模块求值副作用会被 module cache 吞掉",
    ).not.toMatch(/import\(\s*["']@vueuse\/core["']\s*\)/);
  });

  it("runner 按阶段记账（import / render），而不是只报一个总数", () => {
    const code = stripComments(read(RUNNER));
    expect(code).toContain("importPhase");
    expect(code).toContain("renderPhase");
  });

  it("runner 的 DOM 记账只看 window / document（Node 自带 navigator，不是 DOM 证据）", () => {
    const code = stripComments(read(RUNNER));
    const arrayMatch = /for \(const name of \[([^\]]*)\]\)/.exec(code)?.[1];
    expect(arrayMatch, "找不到记账的全局名单").toBeTruthy();
    expect(arrayMatch!, "记账名单里混进了 navigator").not.toContain("navigator");
    expect(arrayMatch!).toContain('"document"');
    expect(arrayMatch!).toContain('"window"');
  });

  it("boundary 的说明不再把 navigator 写成「不许被碰」（避免与实现漂移）", () => {
    const code = stripComments(read(BOUNDARY));
    expect(code, "boundary 仍声称 navigator 不许被碰").not.toContain("navigator");
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
    expect(source).toContain("ssr-status");
    expect(source).toContain("no-map");
  });

  it("runner 跑在纯 Node：不出现 happy-dom / jsdom，且真的编译 SFC", () => {
    const code = stripComments(read(RUNNER));
    expect(code, "runner 引用了 happy-dom").not.toContain("happy-dom");
    expect(code, "runner 引用了 jsdom").not.toContain("jsdom");
    expect(code, "runner 没有编译 SFC（缺 @vue/compiler-sfc）").toContain("@vue/compiler-sfc");
    expect(code, "runner 没有 renderToString").toContain("renderToString");
  });

  it("runner 扣掉了 Vue 自身的 DOM 探测基线（否则渲染阶段增量不成立）", () => {
    const code = stripComments(read(RUNNER));
    expect(code, "runner 没有做基线渲染 —— devtools hook 的 window 访问会算进渲染阶段").toMatch(
      /renderToString\(createSSRApp\(\{\s*render:/,
    );
    expect(code, "runner 没有按基线切增量").toContain("accesses.slice(baseline)");
  });
});

describe("SSR 门禁：判据有牙（合成报告逐个喂）", () => {
  it("合法报告必须通过（避免判据恒假）", () => {
    expect(() => assertBareSsrReport(bareReport())).not.toThrow();
    expect(() => assertInstrumentedSsrReport(instrumentedReport())).not.toThrow();
  });

  it("instrument 允许 import 阶段的守卫式 window 读取", () => {
    expect(() => assertInstrumentedSsrReport(instrumentedReport())).not.toThrow();
  });

  it.each([
    ["bare 渲染前环境被注入 window", () => ({ ...bareReport(), environmentBefore: { ...cleanEnvironment(), windowIn: true } })],
    ["bare 渲染后环境被注入 document", () => ({ ...bareReport(), environmentAfter: { ...cleanEnvironment(), documentOwn: true } })],
    ["bare 环境 typeof 变了", () => ({ ...bareReport(), environmentBefore: { ...cleanEnvironment(), typeofWindow: "object" } })],
    ["版本不一致", () => ({ ...bareReport(), versions: { ...bareReport().versions, serverRenderer: "3.4.0" } })],
    ["版本缺失", () => ({ ...bareReport(), versions: { ...bareReport().versions, compilerSfc: "" } })],
    ["缺容器类名", () => ({ ...bareReport(), html: HTML.replace("bmap-container", "x") })],
    ["缺 canvas host", () => ({ ...bareReport(), html: HTML.replace("bmap-canvas-host", "x") })],
    ["状态不是 idle", () => ({ ...bareReport(), html: HTML.replace("ssr-status\">idle<", "ssr-status\">loading<") })],
    ["服务端拿到了地图实例", () => ({ ...bareReport(), html: HTML.replace("ssr-has-map\">no-map<", "ssr-has-map\">map<") })],
    ["输出注入了 script", () => ({ ...bareReport(), html: `${HTML}<script></script>` })],
    ["loader 状态变了", () => ({ ...bareReport(), loaderStatus: "complete" })],
    ["出现全局 BMap", () => ({ ...bareReport(), bmapGlobal: "object" })],
  ])("bare 违规必须判红：%s", (_label, mutate) => {
    expect(() => assertBareSsrReport(mutate())).toThrow();
  });

  it.each([
    ["import 阶段读了 document", () => ({ ...instrumentedReport(), importPhase: ["window", "document"] })],
    ["渲染阶段读了 document", () => ({ ...instrumentedReport(), renderPhase: ["document"] })],
    ["渲染阶段读了 window", () => ({ ...instrumentedReport(), renderPhase: ["window"] })],
    ["注入 getter 前的环境本就不干净", () => ({ ...instrumentedReport(), environmentBefore: { ...cleanEnvironment(), documentIn: true } })],
    ["instrument 报告缺容器", () => ({ ...instrumentedReport(), html: HTML.replace("bmap-container", "x") })],
    ["instrument 报告 loader 变了", () => ({ ...instrumentedReport(), loaderStatus: "complete" })],
  ])("instrument 违规必须判红：%s", (_label, mutate) => {
    expect(() => assertInstrumentedSsrReport(mutate())).toThrow();
  });

  it("模式写错时必须判红（否则两个 assert 可以拿同一份报告互相顶替）", () => {
    expect(() => assertBareSsrReport(instrumentedReport())).toThrow(/bare/);
    expect(() => assertInstrumentedSsrReport(bareReport())).toThrow(/instrument/);
  });
});
