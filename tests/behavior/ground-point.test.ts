/**
 * GroundPoint 行为门禁（issue #178）
 *
 * 覆盖三件本库必须做对的事：
 *
 * 1. **构造**：几何是**位置参数**（官方 `constructor(point, opts?)`），不是 `<GroundOverlay>`
 *    的 `bounds`；官方默认为 `true` 的两个布尔项在未给时**不进**构造选项。
 * 2. **分类**：逐条验证 `mutable` 的键走**字段级 setter**（同一个实例），`recreate` 的键
 *    走**重建**。这是本票的核心——分类错了「传了不生效」或「默默吞掉更新」。
 * 3. **释放**：卸载后过泄漏门禁（`harness.assertIdle`），与仓库其它覆盖物同一口径。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import GroundPoint from "../../packages/bmap-vue/src/components/overlays/GroundPoint.vue";
import { createFakeV4Harness, type FakeV4GroundPoint } from "../../packages/test-utils";
import { OVERLAY_DESCRIPTORS } from "../../packages/bmap-vue/src/driver/types/overlays";

const { harness, fake } = createFakeV4Harness();
const provider = () => harness.provider();
const host = () => harness.container();

const POINT = { lng: 116.4, lat: 39.9 };

/**
 * 挂一份由 `props`（一个对象 ref）驱动的 `<GroundPoint>`。
 *
 * `props` 必须是 **ref** 而不是普通对象：组件的 props 由 `setup()` 的渲染函数**每次重新读取**，
 * 把字面量对象在闭包里展开一次的话，父级后续改 ref 不会触发任何重渲染（用例会假绿）。
 */
function mountGroundPoint(props: Ref<Record<string, unknown>> = ref({}), position = ref(POINT)) {
  const wrapper = mount(
    defineComponent({
      components: { Map, GroundPoint },
      setup() {
        return () =>
          h(Map, { provider: provider() }, () => [
            h(GroundPoint, { point: position.value, ...props.value }),
          ]);
      },
    }),
    { attachTo: host() },
  );
  return { wrapper, position, props };
}

/** 当前地图上挂着的那个贴地点。 */
function currentGroundPoint(): FakeV4GroundPoint {
  return fake.createdMaps[fake.createdMaps.length - 1]!.overlays[0] as FakeV4GroundPoint;
}

describe("GroundPoint", () => {
  beforeEach(() => harness.reset());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("按位置参数构造（point 走构造函数第一个参数，不进 options）", async () => {
    const { wrapper } = mountGroundPoint(ref({ url: "car.png" }));
    await flushPromises();
    expect(harness.attached("overlay")).toBe(1);
    const gp = currentGroundPoint();
    expect(gp.point).toMatchObject(POINT);
    // `point` 是位置参数，**不能**同时出现在 options 里（否则同一个值既走位置参数又进 options）
    expect(gp.options.point).toBeUndefined();
    expect(gp.options.url).toBe("car.png");
    wrapper.unmount();
    await nextTick();
  });

  it("官方默认 true 的两个布尔项未给时不进构造选项（不把「没给」变成「显式关掉」）", async () => {
    const { wrapper } = mountGroundPoint();
    await flushPromises();
    const gp = currentGroundPoint();
    // Vue 的 Boolean prop 未给时是 false；若原样传下去就会覆盖官方的 @default true
    expect(gp.options.enableMassClear).toBeUndefined();
    expect(gp.options.enableClicking).toBeUndefined();
    expect(gp.options.top).toBeUndefined();
    wrapper.unmount();
    await nextTick();
  });

  it("位置更新走 setPoint（不是 setPosition）且不重建实例", async () => {
    const { wrapper, position } = mountGroundPoint();
    await flushPromises();
    const before = currentGroundPoint();
    position.value = { lng: 121.5, lat: 31.2 };
    await nextTick();
    await flushPromises();
    const after = currentGroundPoint();
    // 同一个实例（没有重建）且经由官方声明的方法名落地
    expect(after).toBe(before);
    expect(after.callLog).toContain("setPoint");
    expect(after.point).toMatchObject({ lng: 121.5, lat: 31.2 });
    expect(harness.attached("overlay")).toBe(1);
    wrapper.unmount();
    await nextTick();
  });

  it("三个 Size 字段就地更新（size/anchor/offset）", async () => {
    const props = ref<Record<string, unknown>>({ size: { width: 30, height: 60 } });
    const { wrapper } = mountGroundPoint(props);
    await flushPromises();
    const gp = currentGroundPoint();
    const before = gp;

    // 关键回归：这三个键走 `size-shape` 档。若错登记成 Pixel 档，watch 键会读 `x` / `y`，
    // `{width, height}` 恒被判成「没变」⇒ 下面这条会红（更新被静默吞掉）。
    props.value = { size: { width: 48, height: 48 } };
    await nextTick();
    await flushPromises();
    expect(gp).toBe(before);
    expect(gp.callLog).toContain("setSize");
    expect(gp.size).toMatchObject({ width: 48, height: 48 });

    wrapper.unmount();
    await nextTick();
  });

  it("构造期键 level 变化时重建实例（官方没有 setLevel）", async () => {
    const props = ref<Record<string, unknown>>({ level: 18 });
    const { wrapper } = mountGroundPoint(props);
    await flushPromises();
    const before = currentGroundPoint();

    props.value = { level: 20 };
    await nextTick();
    await flushPromises();
    const after = currentGroundPoint();
    // 重建：换了实例（`setLevel` 在官方成员表上不存在，就地更新不会生效）
    expect(after).not.toBe(before);
    expect(after.options.level).toBe(20);
    expect(harness.attached("overlay")).toBe(1);
    wrapper.unmount();
    await nextTick();
  });

  it("卸载后释放：监听器与覆盖物都归零（泄漏门禁）", async () => {
    const { wrapper } = mountGroundPoint(ref({ url: "car.png" }));
    await flushPromises();
    // 事件订阅是真实存在的（覆盖物事件矩阵派生了 11 个事件）
    expect(fake.diagnostics.snapshot().leaks.listeners).toBeGreaterThan(0);
    expect(harness.attached("overlay")).toBe(1);

    wrapper.unmount();
    await flushPromises();
    await nextTick();
    expect(harness.attached("overlay")).toBe(0);
    harness.assertIdle("GroundPoint 卸载");
  });

  it("100 次挂载/卸载后诊断归零（无累积泄漏）", async () => {
    for (let i = 0; i < 100; i++) {
      const { wrapper } = mountGroundPoint(ref({ url: "car.png" }));
      await flushPromises();
      wrapper.unmount();
      await nextTick();
    }
    await flushPromises();
    harness.assertIdle("GroundPoint 100 次挂载/卸载");
  });
});


/* ------------------------------------------------------------ 误分类护栏（issue #178）
 *
 * 上面的用例断言的是「**当前分类下的行为是对的**」。本组断言的是反过来的事：
 * **如果有人把分类改错，用例必须红**。
 *
 * ## 为什么需要这一组（标准轴实测发现，并已复现）
 *
 * `FakeV4GroundPoint` 的注释曾承诺「不实现 `setLevel` / `setTop` / `setEnableClicking`，
 * 因此误写成 `options` 的键会让 Fake 抛『成员不存在』，用例会红」。**那个承诺不成立**：
 * `OverlayDriver.setOptions` 对「声明为 `mutable` 但实例上缺该方法」走的是
 * `readNamespaceMember` + `warnOnce`（`driver/jsapi-v4/overlays.ts` 的 `missing:` 分支），
 * **只告警一次、不抛**。实测把 `ground-point.top` 的描述符从
 * `recreate("…没有 setTop…")` 改成 `mutateBy("setTop")`、spec 改成 `"options"` 之后，
 * **全仓 3602 条用例仍然全绿**——在这个面上「分类错了」是**静默通过**的。
 *
 * ## 判据
 *
 * 把判据钉在那条**告警原文**上：误分类 ⇒ Driver 必然发出
 * 「`ground-point.top 声明为 mutable（setTop），但当前实例没有该方法，本次更新被忽略`」
 * ⇒ 本组抓到它 ⇒ 红。Fake 刻意不提供兜底成员这件事，因此从「一句没有断言支撑的注释」
 * 变成**真的护栏**。
 *
 * 两条用例成对：
 * - **正证**：正确分类下**没有**这条告警（否则下面的反证可能因噪声而恒真）；
 * - **反证**：把描述符与 spec 同时改成误分类后，**必须**出现这条告警。
 *
 * 反证用例不改动全局描述符（那会污染同文件其它用例），而是**在用例内临时打补丁**并在
 * `finally` 里还原——判据与真实误分类走的是同一条代码路径（`setOptions` 的 `missing:` 分支）。
 */
describe("GroundPoint 误分类护栏", () => {
  beforeEach(() => harness.reset());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** `OverlayDriver.setOptions` 的「声明为 mutable 但实例缺该方法」告警。 */
  const MISSING_MEMBER_WARN = (key: string, setter: string): string =>
    `OverlayDriver.setOptions: ground-point.${key} 声明为 mutable（${setter}），但当前实例没有该方法`;

  /** 挂一份 props 由 ref 驱动的组件，收集期间 `console.warn` 的首参。 */
  async function warnsDuring(
    body: (props: Ref<Record<string, unknown>>) => Promise<{ warns: string[]; unmount: () => Promise<void> }>,
    initial: Record<string, unknown>,
  ) {
    const warns: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(String(args[0]));
    });
    const props = ref<Record<string, unknown>>(initial);
    try {
      const { wrapper } = mountGroundPoint(props);
      await flushPromises();
      await nextTick();
      const result = await body(props);
      return {
        ...result,
        warns,
        unmount: async () => {
          wrapper.unmount();
          await flushPromises();
          await nextTick();
        },
      };
    } finally {
      spy.mockRestore();
    }
  }

  it("正证：当前分类下更新三个 recreate 键**不产生**「实例没有该方法」告警", async () => {
    const { warns, unmount } = await warnsDuring(
      async (props) => {
        // 三个构造期键各改一次。正确分类下它们走**重建**（`recreate`），不经过 `setOptions`。
        for (const next of [{ level: 20 }, { top: true }, { enableClicking: false }]) {
          props.value = next;
          await nextTick();
          await flushPromises();
        }
        return { warns: [] as string[], unmount: async () => {} };
      },
      { level: 18, top: false, enableClicking: true },
    );
    const missing = warns.filter((line) => line.includes("没有该方法"));
    expect(missing, "正确分类下不应出现「实例没有该方法」告警").toEqual([]);
    await unmount();
  });

  it("反证：把 recreate 键误分类成 options 时**必然**出现「实例没有该方法」告警", async () => {
    // 判据是**行为**而不是描述符的当前取值：这里真的把描述符临时改成误分类的形态，
    // 证明「误分类 ⇒ 告警 ⇒ 用例红」这条链是通的。若有人把 `top` 误写成 `mutateBy("setTop")`
    // + spec `"options"`，本用例会因**没有**捕获到该告警而失败——它就是那道护栏。
    const descriptor = OVERLAY_DESCRIPTORS["ground-point"];
    const original = descriptor.properties.find((entry) => entry.name === "top")!;
    // 只在用例内存活：把 `top` 临时声明成一个 Fake 并不存在的 setter。
    (descriptor as { properties: unknown[] }).properties = descriptor.properties.map((entry) =>
      entry.name === "top" ? { ...entry, policy: "mutable", reason: undefined, setter: "setTop" } : entry,
    );
    try {
      const { warns, unmount } = await warnsDuring(
        async (props) => {
          props.value = { ...props.value, top: true };
          await nextTick();
          await flushPromises();
          return { warns: [] as string[], unmount: async () => {} };
        },
        { top: false },
      );
      const missing = warns.filter((line) => line.includes(MISSING_MEMBER_WARN("top", "setTop")));
      expect(
        missing.length,
        "误分类后应捕获到「没有该方法」告警；实际告警：\n" + warns.join("\n"),
      ).toBeGreaterThan(0);
      await unmount();
    } finally {
      (descriptor as { properties: unknown[] }).properties = descriptor.properties.map((entry) =>
        entry.name === "top" ? original : entry,
      );
    }
  });
});
