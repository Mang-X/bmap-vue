/**
 * SSR 消费者门禁的自测（issue #158 工作包 B）
 *
 * ## 判据只在两处
 *
 * 1. **合成报告的行为反例**：`assertBareSsrReport` / `assertInstrumentedSsrReport` 是纯函数，
 *    这里对每一类违规各喂一份合成报告，确认它抛错；再确认合法报告能过（否则判据可能恒红）。
 * 2. **接线**：`verify:package` 真的调了驱动脚本、CI 不另起第二处。新增门禁最典型的失效
 *    方式是「写了但没跑」，这一条本目录下 `dts-strict-gate.test.ts` 也守着。
 *
 * ## 刻意**不**做的事
 *
 * 不扫描 runner / boundary 的源码形状（顺序、模式分支、变量名、`accesses.slice(baseline)`、
 * 具体函数名等）。#158 的非目标明确写着「不增加锁定源码或注释写法的门禁」：那些检查会让
 * 行为完全不变的重构直接把 CI 变红，而它们验的是「代码长什么样」，不是「runner 实际做了什么」。
 *
 * 两进程拆分、`bare` 环境干净、`instrument` 访问统计这些**运行行为**，由 `verify:package`
 * 对着真实 tarball 的集成门禁验证（CI 的 `package` job）。
 *
 * 「真实 SFC」这条也**不**扫 fixture 文本：runner 报告 `@vue/compiler-sfc` 解析出的
 * `descriptor.template` 事实，判据据此断言（见下面的 `hasTemplate` 反例）。
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
const CONSUMER_MANIFEST = resolve(ROOT, "fixtures/consumer/package.json");

const HTML =
  '<div id="v-0" class="bmap-container"><div class="bmap-canvas-host"></div>' +
  '<span class="ssr-status">idle</span><span class="ssr-has-map">no-map</span></div>';

function read(path: string): string {
  return readFileSync(path, "utf8");
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
    sfc: { path: "ssr/App.vue", hasTemplate: true },
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
    sfc: { path: "ssr/App.vue", hasTemplate: true },
    versions: { vue: "3.5.43", serverRenderer: "3.5.43", compilerSfc: "3.5.43" },
    environmentBefore: cleanEnvironment(),
    // 注入 getter 之后 `in` / `hasOwn` 变成 true —— 判据只看注入**前**的环境。
    environmentAfter: {
      ...cleanEnvironment(),
      windowIn: true,
      documentIn: true,
      windowOwn: true,
      documentOwn: true,
    },
    // `@vueuse/shared` 在模块求值期做守卫式 `typeof window` —— 允许，但必须留痕。
    importPhase: ["window"],
    renderPhase: [],
    html: HTML,
    loaderStatus: "notload",
    bmapGlobal: "undefined",
  };
}

describe("SSR 门禁：接线", () => {
  it("verify:package 调的是同一个 SSR 实现（否则这道门禁写了但没跑）", () => {
    expect(read(VERIFY), "verify-package.mts 没有调用 SSR 门禁").toContain("consumer-ssr.mts");
  });

  it("CI 的 package job 仍然只经 verify:package 这一个入口", () => {
    const workflow = readWorkflow("quality.yml");
    expect(stepBlockContaining(workflow, "verify:package").length).toBeGreaterThan(0);
    expect(workflow, "CI 里出现了 SSR 脚本的第二处调用").not.toContain("consumer-ssr.mts");
  });
});

describe("SSR 门禁：取证输入", () => {
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
    [
      "被测组件不是真实 SFC（没有 template）",
      () => ({ ...bareReport(), sfc: { path: "ssr/App.vue", hasTemplate: false } }),
    ],
    [
      "bare 渲染前环境被注入 window",
      () => ({ ...bareReport(), environmentBefore: { ...cleanEnvironment(), windowIn: true } }),
    ],
    [
      "bare 渲染后环境被注入 document",
      () => ({ ...bareReport(), environmentAfter: { ...cleanEnvironment(), documentOwn: true } }),
    ],
    [
      "bare 环境 typeof 变了",
      () => ({ ...bareReport(), environmentBefore: { ...cleanEnvironment(), typeofWindow: "object" } }),
    ],
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
    [
      "注入 getter 前的环境本就不干净",
      () => ({
        ...instrumentedReport(),
        environmentBefore: { ...cleanEnvironment(), documentIn: true },
      }),
    ],
    ["instrument 报告缺容器", () => ({ ...instrumentedReport(), html: HTML.replace("bmap-container", "x") })],
    ["instrument 报告 loader 变了", () => ({ ...instrumentedReport(), loaderStatus: "complete" })],
    [
      "instrument 报告不是真实 SFC",
      () => ({ ...instrumentedReport(), sfc: { path: "ssr/App.vue", hasTemplate: false } }),
    ],
  ])("instrument 违规必须判红：%s", (_label, mutate) => {
    expect(() => assertInstrumentedSsrReport(mutate())).toThrow();
  });

  it("模式写错时必须判红（否则两个 assert 可以拿同一份报告互相顶替）", () => {
    expect(() => assertBareSsrReport(instrumentedReport())).toThrow(/bare/);
    expect(() => assertInstrumentedSsrReport(bareReport())).toThrow(/instrument/);
  });
});
