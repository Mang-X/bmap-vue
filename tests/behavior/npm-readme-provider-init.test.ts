/**
 * npm README 的 Provider / Map 初始化路径（issue #190）
 *
 * ## 这道用例在防什么
 *
 * 入包 README（`packages/bmap-vue/README.md`）此前教读者写
 * `<BMapProvider :ak="ak">` —— 而 `BMapProviderProps` **没有** `ak`。
 * `check-doc-props`（#190 已把入包 README 纳入扫描面）能在**文本层**挡住它，
 * 这里补的是**运行层**：一个干净应用（没有 `app.use` 默认定义、没有外层 Provider、
 * 没有页面全局）用 README 的写法初始化时，Client 到底建没建起来。
 *
 * 为什么三条都要有：prop 名对不上只是**症状**，真正会伤到用户的是
 * 「照抄示例 → 地图起不来 / Client 缺失」。三层各挡一类：
 *
 * - 文本层：`check-doc-props`（#190 起扫入包 README）挡「声明面里没有的 prop」；
 * - 类型层：`fixtures/consumer/src/npm-readme-examples.vue` 对 tarball 跑 `vue-tsc`，
 *   挡 import 路径 / 变量 / 类型标注在真实发布产物上不成立；
 * - 运行层：**本文件**挡「写法合法但初始化路径真跑不起来」。
 *
 * ⚠️ 实测结论（别再重复踩）：`vue-tsc` **挡不住** `<BMapProvider :ak>` 这类缺陷——
 * 未声明的 prop 落进 `$attrs`，Vue 不报错，退出码是 0。所以文本层那条不是冗余的，
 * 它才是这个缺陷的主防线。
 *
 * ## 口径
 *
 * - 用 Fake v4 排除凭据与外网（最终真实 SDK 验证在 #45）；
 * - 「干净应用」= 不 `app.use(createBMapPlugin)`，即**没有**任何隐藏默认定义；
 * - `fake.createdMaps` 是**只增账本**（`harness.reset()` 按设计只清诊断计数，不清账本），
 *   所以「这次挂载建了几张图」一律读**差值**，不读绝对值；
 * - `assertIdle()` 必须在 `unmount()` **之后**（它断言的是「当前未释放」）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import BMapProvider from "../../packages/bmap-vue/src/components/provider/BMapProvider.vue";
import { createFakeV4Harness } from "../../packages/test-utils";

const { harness, fake } = createFakeV4Harness();
const provider = () => harness.provider();

/** 干净应用（不装插件）里挂一个组件树，返回「本次新建的图数量」。 */
async function mountFresh(
  component: ReturnType<typeof defineComponent>,
): Promise<{ created: number; unmount: () => void }> {
  const before = fake.createdMaps.length;
  const wrapper = mount(component, { attachTo: harness.container() });
  await flushPromises();
  return { created: fake.createdMaps.length - before, unmount: () => wrapper.unmount() };
}

beforeEach(() => {
  harness.reset();
});

describe("#190 · README 的 Provider 写法在干净应用里真的能建出 Client", () => {
  it("`<BMapProvider>` 不传 ak：只给默认定义的子树仍能建图", async () => {
    // README「to give a subtree the app-wide default, pass nothing」那段对应的是
    // 「Provider 不持定义、复用外层」。这里用 `definition` 显式喂进那份默认定义
    // （等价于 app.use 提供的），验证「不传任何 SDK 来源的 Provider 本身不是坏入口」。
    // 注：README 那段写的是「什么都不传，靠 app.use」，而 README 之外的 app.use 在
    // 单测里没有等价物，所以这条走 `definition` 这条等价通道，不是逐字复刻。
    const { created, unmount } = await mountFresh(
      defineComponent({
        components: { BMapProvider, Map },
        setup: () => () =>
          h(
            BMapProvider,
            { definition: { provider: provider(), loadOptions: {} } },
            () => [h(Map, { zoom: 12, height: "200px" })],
          ),
      }),
    );

    expect(created, "干净应用里 <BMapProvider>+<Map> 必须真的建出一张图").toBe(1);
    unmount();
    harness.assertIdle("BMapProvider default-definition subtree");
  });

  it("`<BMapProvider :provider :load-options>`：显式定义在子树里同样生效（README 第二段）", async () => {
    // README「to give a subtree an explicit definition, pass provider (with loadOptions)」
    // 那段的可执行版本。`loadOptions` 只有在**同时**给了 `provider` 时才会被读到——
    // 这正是我在起草时差点写成「单独 `:load-options` 出场」的原因（那样它静默无效）。
    const { created, unmount } = await mountFresh(
      defineComponent({
        components: { BMapProvider, Map },
        setup: () => () =>
          h(
            BMapProvider,
            { provider: provider(), loadOptions: { ak: "readme-ak" } },
            () => [h(Map, { zoom: 12, height: "200px" })],
          ),
      }),
    );

    expect(created, "显式 provider + loadOptions 必须建出地图").toBe(1);
    unmount();
    harness.assertIdle("BMapProvider explicit definition");
  });

  it("单独传 `loadOptions` 而不给 `provider` **不**建图（README 只写 provider+loadOptions 的理由）", async () => {
    // 这条把上面那句注释钉成事实：`ownDefinition` 里 `loadOptions` 只在 `provider`
    // 分支里被读。若哪天它单独也能生效，这条会红——那时 README 的写法要跟着更新，
    // 而不是让文档停留在「看起来能跑」。
    const { created, unmount } = await mountFresh(
      defineComponent({
        components: { BMapProvider, Map },
        setup: () => () =>
          h(BMapProvider, { loadOptions: { ak: "readme-ak" } }, () => [
            h(Map, { zoom: 12, height: "200px" }),
          ]),
      }),
    );

    expect(created, "只给 loadOptions 时不该凭空建出 SDK").toBe(0);
    unmount();
    harness.assertIdle("BMapProvider loadOptions-only");
  });

  it("干净应用里 `<Map :provider>` 也能独立建图（无需任何全局默认定义）", async () => {
    const { created, unmount } = await mountFresh(
      defineComponent({
        components: { Map },
        setup: () => () => h(Map, { provider: provider(), zoom: 12, height: "200px" }),
      }),
    );

    expect(created, "只给 provider 的干净应用必须能建图").toBe(1);
    unmount();
    harness.assertIdle("Map-only explicit provider");
  });

  it("干净应用里既无默认定义也无显式来源 → 必须**明确报错**，不静默建空图", async () => {
    // 「没有隐藏默认」这件事本身要有牙：否则上面几条可能只是「反正都会兜底」。
    const errors: unknown[] = [];
    const { created, unmount } = await mountFresh(
      defineComponent({
        components: { Map },
        setup: () => () =>
          h(Map, { zoom: 12, height: "200px", onError: (e: unknown) => errors.push(e) }),
      }),
    );

    expect(created, "没有任何定义来源时不得建出一张没有 SDK 的地图").toBe(0);
    expect(errors.length, "缺失定义必须经 error 通道明确报出").toBeGreaterThan(0);
    unmount();
    harness.assertIdle("no definition source");
  });
});
