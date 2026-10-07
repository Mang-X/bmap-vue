/**
 * 发布样式的**计算样式**用例（issue #158 工作包 D）
 *
 * 「`./styles.css` 能解析、内容里有那两条规则」是文本层判据（`verify:package`）。这里补的是
 * **层叠层**：把**未改动的** `dist/bmap-vue.css` 注入文档，在真实渲染出来的 `<Autocomplete>`
 * 输入框上读 `getComputedStyle`，确认那两条规则真的作用到了元素上。
 *
 * ## 为什么用 happy-dom 而不是真实浏览器
 *
 * 不需要外网、AK 或 Chromium，CI 的 `quality` job 就能跑（真实浏览器里的官方 widget 行为
 * 归 #45）。happy-dom 会真的按属性选择器做层叠 —— 实测 `position` / `z-index` / `top` /
 * `left` / `max-width` 都能从样式表算出来。
 *
 * ## 为什么要把 dist 的 scope 属性补到元素上
 *
 * 发布 CSS 的选择器是 `.b-auto-complete-input[data-v-<hash>]`。`<hash>` 是**构建期产物**：
 * dist 构建与 vitest 的源码构建用不同的路径算出不同的 hash（实测 dist `da7b80f9`、
 * 源码 `2c812c16`），所以直接注入 dist CSS 不会命中源码渲染出来的元素。
 *
 * 这里的做法是：**CSS 一个字不改**，把 dist 选择器里的那个 scope 属性按它的原值补到被测元素上。
 * 于是被断言的是**发布出去的那份规则**在真实层叠引擎下的结果，而不是一份重写过的样式。
 * 正证守卫：先从 CSS 里抽出 hash，抽不到就失败 —— 否则补属性可能补了个空、断言静默恒假。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import Autocomplete from "../../packages/bmap-vue/src/components/autocomplete/Autocomplete.vue";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness } = createFakeV4Harness();
const PUBLISHED_CSS = resolve(import.meta.dirname, "../../packages/bmap-vue/dist/bmap-vue.css");

function mountAutocomplete(): ReturnType<typeof mount> {
  return mount(
    defineComponent({
      components: { Map, Autocomplete },
      setup: () => () => h(Map, { provider: harness.provider() }, () => [h(Autocomplete, {})]),
    }),
    { attachTo: harness.container() },
  );
}

describe("发布样式的计算样式", () => {
  beforeEach(() => harness.reset());

  it("dist 样式产物存在（本用例依赖 pnpm build:package 的产出）", () => {
    expect(existsSync(PUBLISHED_CSS), `缺少发布样式：${PUBLISHED_CSS}`).toBe(true);
  });

  it("注入未改动的 dist CSS 后，输入框的计算样式来自那份规则", async () => {
    const css = readFileSync(PUBLISHED_CSS, "utf8");
    // 正证守卫：scope hash 抽不出来时，下面「补 scope 属性」那一步会补个空，
    // 断言就会因为「CSS 没命中元素」而静默恒假。
    const scope = /\[data-v-([0-9a-f]+)\]/.exec(css)?.[1];
    expect(scope, "从 dist CSS 里抽不到 scoped 属性选择器 —— 判据会失去锚点").toBeTruthy();

    const wrapper = mountAutocomplete();
    await flushPromises();
    const input = document.querySelector(".b-auto-complete-input") as HTMLElement;
    expect(input, "组件必须渲染出输入框").toBeTruthy();

    // 因果前提：CSS 还没注入时，定位不该已经是 absolute。
    expect(window.getComputedStyle(input).position, "注入前就已经是 absolute，无法归因").not.toBe(
      "absolute",
    );

    // 注入**未改动**的发布 CSS，并让它按自身的 scope hash 命中元素。
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    input.setAttribute(`data-v-${scope!}`, "");
    try {
      const computed = window.getComputedStyle(input);
      expect(computed.position, "position 必须来自发布样式").toBe("absolute");
      expect(computed.zIndex, "z-index 必须来自发布样式").toBe("10");
      expect(computed.top).toBe("10px");
      expect(computed.left).toBe("10px");
      expect(computed.maxWidth).toBe("calc(100% - 20px)");
      expect(computed.boxSizing).toBe("border-box");
    } finally {
      style.remove();
    }

    wrapper.unmount();
  });

  it("发布样式只作用于带该 scope 的元素（不是无条件命中的宽规则）", async () => {
    const css = readFileSync(PUBLISHED_CSS, "utf8");
    const scope = /\[data-v-([0-9a-f]+)\]/.exec(css)?.[1];
    expect(scope).toBeTruthy();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    try {
      const bare = document.createElement("input");
      bare.className = "b-auto-complete-input";
      document.body.appendChild(bare);
      // 没有那个 scope 属性 ⇒ 规则不该命中（否则说明它其实是按 class 无条件生效的）。
      expect(window.getComputedStyle(bare).position).not.toBe("absolute");
      bare.remove();
    } finally {
      style.remove();
    }
  });
});
