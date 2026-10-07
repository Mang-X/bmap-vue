/**
 * 发布样式的**计算样式** runner（issue #158 工作包 D）
 *
 * 跑在**装出来的 tarball** 上（消费 fixture 里 `npm install` 的那个包），断言的是发布 JS 与
 * 发布 CSS 之间的**真实耦合**：
 *
 * 1. 从发布包导入 `<Map>` / `<Autocomplete>`，用 happy-dom 真实渲染；
 * 2. 读输入框上**发布组件自己带的** scope 属性（`data-v-*`）—— 不人工补任何属性；
 * 3. 注入**未改动的**发布 `styles.css`（同一份 tarball 里的那个文件）；
 * 4. 读 `getComputedStyle`，确认规则真的作用到了那个元素上。
 *
 * 于是「发布 JS 的 scope 与发布 CSS 的 scope 一致」是**被断言的事实**，而不是测试补出来的：
 * 发布组件丢了 scope 绑定、或者上游把 scope 属性改到别的元素上，这里都会红。
 *
 * happy-dom 会真的按属性选择器做层叠（实测 `position` / `z-index` / `top` / `left` /
 * `max-width` 都能从样式表算出来），因此不需要外网 / AK / Chromium。
 *
 * 用法（由 `scripts/consumer-styles.mts` 调用，cwd 是装好依赖的消费 fixture）：
 *   node styles/computed-style-runner.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Window } from "happy-dom";

const dir = process.cwd();
const require = createRequire(import.meta.url);

/** 发布样式的解析路径走 Node 自己的规则，不拼 `node_modules/...` 相对路径。 */
const stylesPath = require.resolve("bmap-vue/styles.css");
const publishedCss = readFileSync(stylesPath, "utf8");

/** 发布组件实际渲染出来的 scope 属性（`data-v-*`）。没有它就不能做任何结论。 */
const SCOPE_ATTRIBUTE = /^data-v-[0-9a-f]+$/;

const window = new Window({ url: "https://example.test/" });
const { document } = window;

// happy-dom 提供的浏览器 API 必须先就位，再 import 发布产物：Vue 与库在模块求值 / 挂载期
// 都会做环境探测（`typeof document` 这类）。
// 用 defineProperty 而不是直接赋值：Node 自带的 `navigator` 只有 getter（21+ 的 Web 标准
// 全局），直接赋值会抛 `Cannot set property navigator`。本用例只关心 DOM 层叠，
// 把 happy-dom 的全局逐个装上即可。
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "SVGElement",
  "getComputedStyle",
  // 本库经 @vueuse/core 用 ResizeObserver / IntersectionObserver 观察容器尺寸；
  // happy-dom 的 `Window` 上不一定有，装上免得在挂载期抛错（本用例只判计算样式）。
  "ResizeObserver",
  "IntersectionObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key],
  });
}

// 样式必须在**渲染之前**注入并生效：happy-dom 的 getComputedStyle 读的是当前样式表集合。
const style = document.createElement("style");
style.textContent = publishedCss;
document.head.appendChild(style);

const { createApp, h } = await import("vue");
const { Map, Autocomplete } = await import("bmap-vue");
const { createBMapClientDefinition } = await import("bmap-vue");

/**
 * 一个**结构化**的 Provider，`load()` 直接返回一个最小 fake SDK —— 本用例只关心 DOM 上的
 * 计算样式，地图能不能建起来不是判据（真实 SDK 的建图路径由 #45 的真实 smoke 负责）。
 */
const provider = {
  name: "computed-style-probe",
  async load() {
    return { engine: "jsapi-v4", version: "4.0", namespace: { Map: class {}, Autocomplete: class {} } };
  },
  getCacheKey: () => "computed-style-probe",
};

const host = document.createElement("div");
document.body.appendChild(host);

const app = createApp({
  render: () =>
    h(Map, { provider, definition: createBMapClientDefinition({ provider, loadOptions: {} }) }, () => [
      h(Autocomplete, {}),
    ]),
});
app.mount(host);

// 等 Vue 的挂载与微任务落定。
await new Promise((done) => setTimeout(done, 0));

const input = document.querySelector(".b-auto-complete-input");
if (input === null) {
  throw new Error("发布组件没有渲染出 .b-auto-complete-input —— 计算样式无从谈起");
}

/** 元素上**由发布组件自己带上**的 scope 属性。 */
const scopeAttributes = [...input.attributes]
  .map((attribute) => attribute.name)
  .filter((name) => SCOPE_ATTRIBUTE.test(name));
const computed = window.getComputedStyle(input);
const report = {
  stylesPath,
  scopeAttributes,
  cssHasMatchingScope: scopeAttributes.some((name) => publishedCss.includes(`[${name}]`)),
  computed: {
    position: computed.position,
    zIndex: computed.zIndex,
    top: computed.top,
    left: computed.left,
    maxWidth: computed.maxWidth,
    boxSizing: computed.boxSizing,
  },
  // 反证：没有 scope 属性的同类元素不该命中那条规则。
  barePosition: (() => {
    const bare = document.createElement("input");
    bare.className = "b-auto-complete-input";
    document.body.appendChild(bare);
    return window.getComputedStyle(bare).position;
  })(),
};

process.stdout.write(`${JSON.stringify(report)}\n`);
