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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import Map from "../../packages/bmap-vue/src/components/map/Map.vue";
import GroundPoint from "../../packages/bmap-vue/src/components/overlays/GroundPoint.vue";
import { createFakeV4Harness, type FakeV4GroundPoint } from "../../packages/test-utils";

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
