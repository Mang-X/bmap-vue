/**
 * 路线服务 composable 行为测试（M7-ROUTES / issue #39）
 *
 * 对应 issue 的「测试与验收」里属于 composable 层的那几条：
 * - 四类服务在 `<BMap>` 子树里可用、统一状态口径、卸载后**结果集**被收回（泄漏门禁）；
 * - **render 开关**：默认不绘制；显式给 `renderOptions.map` 时真的把地图交给 SDK（且所有权可验证）；
 * - **快速重复检索**：新检索取代在飞检索时换新实例，迟到回包不污染新结果；
 * - **构造期选项变化才重建**（含「每次求值都是新对象」的 getter 不触发重建）；
 * - `<BMapProvider>`（无地图）子树里的两种结果：显式给 `location` 可用 / 不给则显式失败；
 * - **UI 与 headless 分流**：两条路径互不引用（同一次界面操作只会发一次请求）。
 *
 * 断言全部落在可观察事实上：Fake 的 `callLog` 与 `rawRoutes` 账本、诊断的 `leaks.routeResults`、
 * 归一化结果的 `status` / `error.code`。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMapProvider from "../../packages/baidu-map-gl-vue/src/components/provider/BMapProvider.vue";
import { useBMap } from "../../packages/baidu-map-gl-vue/src/composables/useBMap";
import { useBMapDrivingRoute } from "../../packages/baidu-map-gl-vue/src/composables/useBMapDrivingRoute";
import { useBMapWalkingRoute } from "../../packages/baidu-map-gl-vue/src/composables/useBMapWalkingRoute";
import { useBMapRidingRoute } from "../../packages/baidu-map-gl-vue/src/composables/useBMapRidingRoute";
import { useBMapTransitRoute } from "../../packages/baidu-map-gl-vue/src/composables/useBMapTransitRoute";
import { DrivingPolicy } from "../../packages/baidu-map-gl-vue/src/driver/types/services";
import { createFakeV4Harness } from "../../packages/test-utils";

let harness: ReturnType<typeof createFakeV4Harness>["harness"];
let fake: ReturnType<typeof createFakeV4Harness>["fake"];

function provider() {
  return harness.provider();
}

const from = { lng: 116.391, lat: 39.91 };
const to = { lng: 116.431, lat: 39.931 };

/** 在 `<BMap>` 子树里挂一个用给定 hook 的组件（有地图上下文 ⇒ `location` 可省略）。 */
function mountInMap<T>(
  useHook: () => T,
  run: (hook: T) => void | Promise<void>,
  options: { provider?: ReturnType<typeof provider> } = {},
) {
  const el = harness.container();
  const Child = defineComponent({
    setup() {
      const hook = useHook();
      void Promise.resolve(run(hook));
      return () => h("div", "route");
    },
  });
  return mount(
    defineComponent({
      components: { BMap, Child },
      setup: () => () => h(BMap, { provider: options.provider ?? provider() }, () => [h(Child)]),
    }),
    { attachTo: el },
  );
}

/** 只挂 `<BMapProvider>`（**没有地图实例**）：client-only 服务必须同样可用。 */
function mountInProvider<T>(
  useHook: () => T,
  run: (hook: T) => void | Promise<void>,
) {
  const el = harness.container();
  const Child = defineComponent({
    setup() {
      const hook = useHook();
      void Promise.resolve(run(hook));
      return () => h("div", "route");
    },
  });
  return mount(
    defineComponent({
      components: { BMapProvider, Child },
      setup: () => () =>
        h(
          BMapProvider,
          { definition: { provider: provider(), loadOptions: { ak: "fake-ak" } } },
          () => [h(Child)],
        ),
    }),
    { attachTo: el },
  );
}

/** 捕获 hook 实例（行为测试要在 setup 之后继续驱动它）。 */
function capture<T>(): { hook: () => T; set: (value: T) => void } {
  let current: T | null = null;
  return {
    hook: () => {
      if (current === null) throw new Error("hook 尚未创建");
      return current;
    },
    set: (value: T) => {
      current = value;
    },
  };
}

describe("useBMapDrivingRoute：headless 驾车路线", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("检索归一化结果；卸载后 SDK 结果集被收回（泄漏门禁）", async () => {
    const slot = capture<ReturnType<typeof useBMapDrivingRoute>>();
    const wrapper = mountInMap(() => useBMapDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();

    const hook = slot.hook();
    const result = await hook.search(from, to);
    await flushPromises();

    expect(result.status).toBe("success");
    expect(result.data?.plans).toHaveLength(1);
    expect(result.data?.plans[0]?.legs).toHaveLength(2);
    expect(result.data?.plans[0]?.legs[0]?.steps).toHaveLength(2);
    expect(hook.status.value).toBe("success");
    expect(hook.isLoading.value).toBe(false);
    expect(hook.sdkStatus.value).toBe(0);
    expect(hook.supported.value).toBe(true);
    expect(fake.rawRoutes.DrivingRoute[0]?.callLog.filter((e) => e.startsWith("search:"))).toHaveLength(1);

    wrapper.unmount();
    await flushPromises();
    // 卸载 ⇒ disposeRoute ⇒ 公开的 clearResults() ⇒ 结果集销账
    harness.assertIdle("useBMapDrivingRoute 卸载");
  });

  it("默认不绘制：不传 renderOptions 时 SDK 侧没有任何绘制配置", async () => {
    const slot = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInMap(() => useBMapDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();
    await slot.hook().search(from, to);

    const raw = fake.rawRoutes.DrivingRoute[0]!;
    expect("renderOptions" in raw.options).toBe(false);
  });

  it("显式 renderOptions.map 时把**本库地图句柄**解析成 raw 地图交给 SDK", async () => {
    const slot = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInMap(
      () => {
        const { map } = useBMap();
        return useBMapDrivingRoute({ renderOptions: { map, autoViewport: true } });
      },
      (hook) => slot.set(hook),
    );
    await flushPromises();
    await slot.hook().search(from, to);

    const raw = fake.rawRoutes.DrivingRoute[0]!;
    const renderOptions = raw.options.renderOptions as Record<string, unknown>;
    expect(renderOptions.autoViewport).toBe(true);
    // 交给 SDK 的必须是地图的 raw 对象（而不是句柄）——否则 SDK 侧拿到的是非法值
    expect(renderOptions.map).toBe(fake.createdMaps[0]);
    // 句柄身份可验证：`map` 不在 raw 配置里以句柄形态出现
    expect(typeof renderOptions.map).toBe("object");
  });

  it("快速重复检索：新检索换新实例，旧实例的迟到回包不污染结果", async () => {
    const slot = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInMap(() => useBMapDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();
    const hook = slot.hook();

    await hook.search(from, to); // 预热：实例已建
    const first = fake.rawRoutes.DrivingRoute[0]!;
    first.queue.auto = false; // 让下一次检索挂在「未回包」上

    const inflight = hook.search(from, to);
    const replaced = hook.search(to, from); // 取代在飞检索
    await flushPromises();

    expect((await inflight).status).toBe("canceled");
    expect((await replaced).status).toBe("success");
    // 归属依赖实例身份 ⇒ 取代时换新实例（旧实例的迟到回包只会落到它自己身上）
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(2);
    expect(first.callLog).toContain("clearResults"); // 旧实例被释放（公开的清理入口）

    first.queue.flush(); // 迟到回包到达：没有任何在册操作
    const third = await hook.search(to, from);
    expect(third.status).toBe("success");
    expect(third.data?.start?.title).toBe("起点");
  });

  it("clear() 释放实例并清空状态：公开的 clearResults() 被调用、结果集归零", async () => {
    const slot = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInMap(() => useBMapDrivingRoute(), (hook) => slot.set(hook));
    await flushPromises();
    const hook = slot.hook();
    await hook.search(from, to);
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(1);

    hook.clear();
    expect(hook.data.value).toBeNull();
    expect(hook.status.value).toBe("idle");
    expect(raw.callLog).toContain("clearResults");
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(0);

    // 清空之后仍可继续检索（会重建实例）
    expect((await hook.search(from, to)).status).toBe("success");
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(2);
  });

  it("构造期选项变化才重建；每次求值都是新对象的 getter 不触发重建", async () => {
    const policy = ref<DrivingPolicy>(DrivingPolicy.DEFAULT);
    const slot = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInMap(
      () => useBMapDrivingRoute({ policy, renderOptions: () => ({ autoViewport: true }) }),
      (hook) => slot.set(hook),
    );
    await flushPromises();
    const hook = slot.hook();

    await hook.search(from, to);
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(1);

    // 触发一次渲染：`renderOptions` 是 getter（每次求值新对象），内容没变 ⇒ **不能**重建
    await nextTick();
    await hook.search(from, to);
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(1);

    // 策略真的变了 ⇒ 重建，且新实例带上了新策略
    policy.value = DrivingPolicy.AVOID_CONGESTION;
    await nextTick();
    await hook.search(from, to);
    expect(fake.rawRoutes.DrivingRoute).toHaveLength(2);
    expect(fake.rawRoutes.DrivingRoute[1]?.options.policy).toBe(DrivingPolicy.AVOID_CONGESTION);
  });

  it("没有地图也没有 location 时显式失败；给了 location 就可用", async () => {
    const missing = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInProvider(() => useBMapDrivingRoute(), (hook) => missing.set(hook));
    await flushPromises();

    const failed = await missing.hook().search(from, to);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(failed.error?.message).toContain("缺少检索区域");

    const provided = capture<ReturnType<typeof useBMapDrivingRoute>>();
    mountInProvider(() => useBMapDrivingRoute({ location: "北京市" }), (hook) =>
      provided.set(hook),
    );
    await flushPromises();
    const ok = await provided.hook().search(from, to);
    expect(ok.status).toBe("success");
  });
});

describe("useBMapWalkingRoute / useBMapRidingRoute / useBMapTransitRoute", () => {
  beforeEach(() => {
    const created = createFakeV4Harness();
    harness = created.harness;
    fake = created.fake;
  });

  it("步行 / 骑行：字符串起终点可用，结果与驾车同构", async () => {
    const walking = capture<ReturnType<typeof useBMapWalkingRoute>>();
    const walkingWrapper = mountInMap(() => useBMapWalkingRoute(), (hook) => walking.set(hook));
    await flushPromises();
    const walkResult = await walking.hook().search("天安门", "王府井");
    expect(walkResult.status).toBe("success");
    expect(walkResult.data?.plans[0]?.legs[0]?.routeType).toBe(2);
    walkingWrapper.unmount();
    await flushPromises();
    harness.assertIdle("walking 卸载");

    const riding = capture<ReturnType<typeof useBMapRidingRoute>>();
    const ridingWrapper = mountInMap(() => useBMapRidingRoute(), (hook) => riding.set(hook));
    await flushPromises();
    const rideResult = await riding.hook().search("北京大学", "清华大学");
    expect(rideResult.status).toBe("success");
    expect(rideResult.data?.plans[0]?.legs[0]?.routeType).toBe(6);
    ridingWrapper.unmount();
    await flushPromises();
    harness.assertIdle("riding 卸载");
  });

  it("公交：换乘段投影成「步行 + 乘车」序列，并给出 transitType", async () => {
    const slot = capture<ReturnType<typeof useBMapTransitRoute>>();
    const wrapper = mountInMap(() => useBMapTransitRoute({ pageCapacity: 3 }), (hook) =>
      slot.set(hook),
    );
    await flushPromises();

    const result = await slot.hook().search("天安门", "北京西站");
    expect(result.status).toBe("success");
    const plan = result.data?.plans[0]!;
    expect(plan.segments.map((segment) => segment.kind)).toEqual(["walk", "line"]);
    expect(result.data?.transitType).toBe(0);
    expect(fake.rawRoutes.TransitRoute[0]?.options.pageCapacity).toBe(3);

    wrapper.unmount();
    await flushPromises();
    harness.assertIdle("transit 卸载");
  });

  it("能力不支持时 supported 为 false、状态是 unsupported，且**一次请求都没发**", async () => {
    delete (fake.namespace as unknown as Record<string, unknown>).TransitRoute;
    const slot = capture<ReturnType<typeof useBMapTransitRoute>>();
    mountInMap(() => useBMapTransitRoute(), (hook) => slot.set(hook));
    await flushPromises();

    const hook = slot.hook();
    expect(hook.supported.value).toBe(false);
    const result = await hook.search("天安门", "北京西站");
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_CAPABILITY_UNSUPPORTED");
    expect(hook.status.value).toBe("unsupported");
    expect(fake.rawRoutes.TransitRoute).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 分流门禁：headless 与官方 UI Kit 互不引用                                     */
/* -------------------------------------------------------------------------- */

const PACKAGE_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/baidu-map-gl-vue/src",
);

/**
 * 递归收集目录下的 `.ts`（排除测试文件）。
 *
 * **目录枚举而不是写死文件名单**：写死的清单在「新增一个桥接文件」或「把引用放进子目录」时会静默失效，
 * 而静态门禁失效是最难发现的一类问题（它继续绿）。同一理由适用于 `integrations/ui-kit` 那一侧。
 */
function sourcesIn(relativeDir: string): string[] {
  const root = join(PACKAGE_SRC, relativeDir);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function sourceOf(relative: string): string {
  return readFileSync(join(PACKAGE_SRC, relative), "utf8");
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;(){}])\/\/[^\n]*/g, "$1");
}

describe("UI 与 headless 分流（同一次界面操作只走一条路径）", () => {
  /**
   * 门禁的三种失效方式都要防：
   * 1. **判定对象错位**——要在**源码**上判，且剥掉注释（我们自己在注释里讨论过 UI Kit）；
   * 2. **判定式写歪**——用一条**正证**（同一判定式对「确实引用上游包」的文件必须命中）证明它有效；
   * 3. **范围写错导致空转**——枚举目录并断言文件数下限 + 每个文件有实质内容，避免「一个文件都没扫到
   *    也算通过」。
   */
  it("composables 下的任何文件都不引用 UI Kit（含上游包与 BRoutePlan）", () => {
    const files = sourcesIn("composables");
    expect(files.length).toBeGreaterThanOrEqual(5); // 现在 5 个路线文件之外还有既有 hooks，少于它说明枚举失效
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code.length).toBeGreaterThan(100);
      if (/jsapi-ui-kit|BRoutePlan|integrations\/ui-kit/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("UI Kit 集成目录下的任何文件都不引用路线 hooks（正证：加载点确实引用上游包）", () => {
    // 正证：`loadUiKit.ts` 是本库唯一的 UI Kit 加载点。用**同一套**「字符串出现」判定式对它断言，
    // 若它在这里为真、而上面的负向断言为假，说明判定式本身有效（不是恒真的空转断言）。
    expect(stripComments(sourceOf("integrations/ui-kit/loadUiKit.ts"))).toContain(
      "@baidumap/jsapi-ui-kit",
    );

    const files = sourcesIn("integrations/ui-kit");
    expect(files.length).toBeGreaterThanOrEqual(6);
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code.length).toBeGreaterThan(100);
      if (/useBMap(Driving|Walking|Riding|Transit)Route|composables\/routeServices/.test(code)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
