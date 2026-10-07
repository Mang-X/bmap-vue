/**
 * SSR 消费者 runner（issue #158 工作包 B）
 *
 * 用 `@vue/compiler-sfc` 真实编译 `ssr/App.vue`，执行编译产物，再 `renderToString` 渲染
 * 含 `<Map>` 的组件。判据在 `scripts/consumer-ssr-boundary.mts`（由 `scripts/consumer-ssr.mts`
 * 读这里的 JSON 报告后执行），本文件只负责**取证**，不自己下结论。
 *
 * ## 为什么要跑两遍（`bare` / `instrument`）
 *
 * 「真实纯 Node 能渲染」与「没有 DOM 访问」是两个结论，取证方式互相冲突，必须分开：
 *
 * - `bare`：**一个全局都不注入**。这才忠实于真实消费者 —— `'window' in globalThis`
 *   与 `Object.hasOwn(globalThis, 'window')` 都必须为 `false`。注入 getter 之后这两条会
 *   变成 `true`，语义就不再是纯 Node，靠「读取值仍是 undefined」区分不出来。
 * - `instrument`：把 `document` / `window` 换成会记账的访问器，只用来**统计访问**。
 *   注入发生在取证环境之后，所以它不影响 `bare` 那一遍的可信度。
 *
 * 两遍跑在**两个独立进程**里：同一进程先注入再删除也救不回 `bare` —— module cache 已经
 * 热了，`bmap-vue`（及其依赖）的模块求值不会再发生，恰恰把要证的那一段吞掉。
 *
 * ## 为什么两遍都不预加载 `@vueuse/core`
 *
 * `Map.vue -> useMapSuspension.ts -> @vueuse/core` 是**真实 import closure**。预加载会把它的
 * 模块求值副作用吞进 module cache：将来它在求值期新增 DOM 访问，后续 `bmap-vue` 的 import
 * 也不会再触发，增量仍是 0。所以让它随真实消费链首次加载，并由 `instrument` 那一遍按
 * **阶段**（import / render）分别记账。
 *
 * 官方 loader 是唯一在基线之前 import 的包：报告要读它的 `getStatus()` 证明「服务端没有加载
 * SDK」，而它的无 DOM 契约另有门禁（`tests/behavior/official-packages-ssr.test.ts`）。
 *
 * 用法（由 `scripts/consumer-ssr.mts` 调用，cwd 必须是装好依赖的消费 fixture）：
 *   node ssr/ssr-runner.mjs <bare|instrument> [sfcPath]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = process.cwd();
const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? "bare";
if (mode !== "bare" && mode !== "instrument") {
  throw new Error(`ssr-runner: 未知模式 ${mode}（只认 bare / instrument）`);
}
const sfcPath = process.argv[3] ? resolve(process.argv[3]) : resolve(dir, "ssr/App.vue");

/** 读装出来的包版本：直接读 `node_modules` 下的 manifest，不赌 `exports` 里有 `./package.json`。 */
const versionOf = (pkg) =>
  JSON.parse(readFileSync(resolve(dir, "node_modules", pkg, "package.json"), "utf8")).version;

/**
 * 环境的**全部**证据面：只报 `typeof` 会漏掉「属性被注入但值为 undefined」。
 * `in` 与 `Object.hasOwn` 一起看，才能区分「真的没有这个全局」与「有但读出来是 undefined」。
 */
const captureEnvironment = () => ({
  typeofWindow: typeof globalThis.window,
  typeofDocument: typeof globalThis.document,
  windowIn: "window" in globalThis,
  documentIn: "document" in globalThis,
  windowOwn: Object.hasOwn(globalThis, "window"),
  documentOwn: Object.hasOwn(globalThis, "document"),
});

const environmentBefore = captureEnvironment();

// 访问记账只在 instrument 模式装；bare 模式**一个全局都不碰**。
const accesses = [];
if (mode === "instrument") {
  for (const name of ["document", "window"]) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        accesses.push(name);
        return undefined;
      },
    });
  }
}

await import("vue");
const { createSSRApp, h } = await import("vue");
const { renderToString } = await import("vue/server-renderer");
const loader = await import("@baidumap/jsapi-loader");

// 基线：把 Vue 自己在 SSR 下会做的探测（devtools hook 等）先发生掉。devtools hook 在
// `createSSRApp` 时才读，所以只 import `vue` 不够，基线必须包含一次最小渲染。
await renderToString(createSSRApp({ render: () => h("div") }));
const baseline = accesses.length;

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

// import 阶段：`@mangax/bmap-vue` 与它的依赖（含 `@vueuse/core`）在这里第一次求值。
const App = (await import(pathToFileURL(compiledPath).href)).default;
const importPhase = accesses.slice(baseline);
const afterImport = accesses.length;

const html = await renderToString(createSSRApp(App));
const renderPhase = accesses.slice(afterImport);

console.log(
  JSON.stringify({
    mode,
    sfc: "ssr/App.vue",
    versions: {
      vue: versionOf("vue"),
      // 显式声明的 @vue/server-renderer 与 @vue/compiler-sfc 必须与 vue 同版本：
      // 三者不同版是 SFC 编译 / SSR 渲染最典型的「装了两个 Vue」故障源。
      serverRenderer: versionOf("@vue/server-renderer"),
      compilerSfc: versionOf("@vue/compiler-sfc"),
    },
    environmentBefore,
    environmentAfter: captureEnvironment(),
    importPhase,
    renderPhase,
    html,
    loaderStatus: loader.getStatus(),
    bmapGlobal: typeof globalThis.BMap,
  }),
);
