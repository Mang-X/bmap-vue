/**
 * SSR 消费者 runner（issue #158 工作包 B）
 *
 * 在**纯 Node（无 happy-dom / jsdom）**里：用 `@vue/compiler-sfc` 真实编译 `ssr/App.vue`，
 * 执行编译产物，再用 `renderToString` 渲染 `<Map>`。判据本身在
 * `scripts/consumer-ssr-boundary.mts`（由 `scripts/consumer-ssr.mts` 读这里的 JSON 报告后执行），
 * 本文件只负责**取证**，不自己下结论。
 *
 * ## 为什么要装 DOM 访问记账器
 *
 * 「无 DOM」不能只靠「没报错」：`typeof window` 这类守卫本身就要求 `window` 存在（只是为
 * `undefined`）。所以这里把 `document` / `window` 换成会记账的访问器（`navigator` 见下，
 * Node 自带，不记账），再对**增量**下断言 —— 「入口与渲染不碰 DOM」因此是可被证伪的结论。
 *
 * 记账必须扣掉基线：Vue 自己在 `createSSRApp` 时会探 `window.__VUE_DEVTOOLS_GLOBAL_HOOK__`，
 * 那是上游行为。基线用**一次最小 SSR 渲染**把这条路径先走掉（只 import `vue` 不够 ——
 * devtools hook 在应用创建时才读），于是本库自己的增量是干净的 0。
 *
 * ## 为什么先 import 官方 loader
 *
 * 报告要证明「服务端没有加载 SDK」：渲染后读 `@baidumap/jsapi-loader` 的 `getStatus()`，
 * 必须仍是 `notload`。在基线**之前** import 它，是为了把它的模块求值从「本库增量」里排除 ——
 * 它的无 DOM 契约另有门禁（`tests/behavior/official-packages-ssr.test.ts`）。
 *
 * 用法（由 `scripts/consumer-ssr.mts` 调用，cwd 必须是装好依赖的消费 fixture）：
 *   node ssr/ssr-runner.mjs [sfcPath]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.cwd();
const require = createRequire(import.meta.url);
const sfcPath = process.argv[2] ? resolve(process.argv[2]) : resolve(dir, "ssr/App.vue");

/** 读装出来的包版本：直接读 `node_modules` 下的 manifest，不赌 `exports` 里有 `./package.json`。 */
const versionOf = (pkg) =>
  JSON.parse(readFileSync(resolve(dir, "node_modules", pkg, "package.json"), "utf8")).version;

// 先取证「环境里真的没有 DOM」，再装访问器 —— 装完之后 `typeof window` 就成了 undefined，
// 那一步就再也分不出「本来就没有」与「访问器返回 undefined」。
//
// 只看 `window` / `document`，**不看 `navigator`**：Node 21+ 自带 Web 标准的 `navigator`
// 全局，它的存在不是 DOM 证据；本库若读它也不构成「要求浏览器」。浏览器 DOM 的硬信号是
// `window` / `document` 这两个。
const environment = {
  hasWindow: typeof globalThis.window !== "undefined",
  hasDocument: typeof globalThis.document !== "undefined",
};

const domAccesses = [];
for (const name of ["document", "window"]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      domAccesses.push(name);
      return undefined;
    },
  });
}

await import("vue");
await import("@vueuse/core");
const loader = await import("@baidumap/jsapi-loader");
const { createSSRApp, h } = await import("vue");
const { renderToString } = await import("vue/server-renderer");

// 基线：把 Vue 自己在 SSR 下会做的探测（devtools hook 等）先发生掉。
await renderToString(createSSRApp({ render: () => h("div") }));
const baseline = domAccesses.length;

const { parse, compileScript } = require("@vue/compiler-sfc");
const source = readFileSync(sfcPath, "utf8");
const { descriptor, errors } = parse(source, { filename: sfcPath });
if (errors.length > 0) {
  throw new Error(
    `ssr-runner: SFC 解析失败：\n${errors.map((error) => `  - ${error.message}`).join("\n")}`,
  );
}
const compiled = compileScript(descriptor, { id: "ssr-consumer", inlineTemplate: true });
const compiledPath = resolve(dir, ".ssr-app.generated.mjs");
writeFileSync(compiledPath, compiled.content);
const App = (await import(pathToFileURL(compiledPath).href)).default;

const html = await renderToString(createSSRApp(App));

console.log(
  JSON.stringify({
    sfc: "ssr/App.vue",
    versions: {
      vue: versionOf("vue"),
      // 显式声明的 @vue/server-renderer 与 @vue/compiler-sfc 必须与 vue 同版本：
      // 三者不同版是 SFC 编译 / SSR 渲染最典型的「装了两个 Vue」故障源。
      serverRenderer: versionOf("@vue/server-renderer"),
      compilerSfc: versionOf("@vue/compiler-sfc"),
    },
    environment,
    domAccessDelta: domAccesses.slice(baseline),
    html,
    loaderStatus: loader.getStatus(),
    bmapGlobal: typeof globalThis.BMap,
  }),
);
