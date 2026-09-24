/**
 * useOverlayResource：重建进行中的更新不能被丢弃（PR #61 评审 P2-1）
 *
 * 评审反例：`applyOptions({ enableClicking: false })` 触发 rebuild（create 异步、`resource` 期间为
 * `null`），创建尚未完成时又改回 `true`/改别的 mutable 键 —— 第二次 `applyOptions` 因为
 * `!current` 直接返回，最终挂载的实例与最新 props 不一致（既没有记录待应用的值，也没有淘汰
 * 正在创建的旧版本）。
 *
 * 这里用**可控 Promise** 的 `create` 精确卡住那个窗口，而不是靠 `flushPromises()` 撞运气。
 */
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide, reactive } from "vue";
import { mapContextKey, type MapContext } from "../context/types";
import { useOverlayResource, type OverlayLifecycle, type UseOverlayResourceResult } from "./useOverlayResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Instance {
  id: number;
}

function setupHarness() {
  const pendingCreates: Array<{ resolve: (value: Instance) => void; props: Record<string, unknown> }> = [];
  const setOptionsCalls: Array<{ instance: Instance; options: Record<string, unknown> }> = [];
  /** 挂载回调钩子：模拟「业务在 addToMap 里同步再推一条更新」 */
  const hooks: { onAddToMap: ((instance: Instance) => void) | null } = { onAddToMap: null };

  const overlaysApi = {
    // 只把 enableClicking 当构造期属性，其余当 mutable
    updatePolicy: (_handle: unknown, key: string) =>
      key === "enableClicking" ? "recreate" : "mutable",
    setOptions: (handle: Instance, options: Record<string, unknown>) => {
      setOptionsCalls.push({ instance: handle, options });
    },
  };

  const lifecycle: OverlayLifecycle<Record<string, unknown>, Instance> = {
    // 返回**可控 Promise**：测试自己决定创建何时完成，从而精确卡住「重建进行中」的窗口
    create: (_ctx, props) => {
      const d = deferred<Instance>();
      pendingCreates.push({ resolve: d.resolve, props: props as Record<string, unknown> });
      return d.promise;
    },
    addToMap: (resource) => {
      hooks.onAddToMap?.(resource as Instance);
    },
    remove: () => {},
  };

  const readyCtx = {
    client: { driver: { overlays: overlaysApi } },
    map: { raw: {} },
  };
  const mapCtx = {
    whenReady: async () => readyCtx,
    events: { emit: vi.fn() },
  } as unknown as MapContext;

  const props = reactive<Record<string, unknown>>({ enableClicking: true, title: "initial" });
  let result!: UseOverlayResourceResult<Instance>;
  // provide 对**后代**可见，所以必须由父组件 provide、子组件里调用 composable
  const Consumer = defineComponent({
    setup() {
      result = useOverlayResource<Record<string, unknown>, Instance>(props, lifecycle);
      return () => h("div");
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(mapContextKey, mapCtx);
        return () => h(Consumer);
      },
    }),
  );

  return { result, props, pendingCreates, setOptionsCalls, hooks, wrapper };
}

/** 把后续创建全部放行并排空队列（重复 resolve 是 no-op，因此每轮重放安全） */
async function settleCreates(harness: ReturnType<typeof setupHarness>, maxRounds = 8): Promise<void> {
  for (let round = 0; round < maxRounds; round++) {
    const countBefore = harness.pendingCreates.length;
    harness.pendingCreates.forEach((create, index) => create.resolve({ id: index + 1 }));
    await flushPromises();
    await flushPromises();
    if (harness.pendingCreates.length === countBefore && harness.result.resource.value) return;
  }
}

/** 某个实例上最后一次 setOptions 的入参 */
function lastAppliedOn(
  harness: ReturnType<typeof setupHarness>,
  instanceId: number,
): Record<string, unknown> | undefined {
  return harness.setOptionsCalls.filter((c) => c.instance.id === instanceId).at(-1)?.options;
}

/** 挂载并完成第一次创建（首次 create 也走可控 Promise） */
async function mountWithFirstInstance(harness: ReturnType<typeof setupHarness>) {
  await flushPromises();
  harness.pendingCreates[0].resolve({ id: 1 });
  await flushPromises();
}

describe("useOverlayResource.applyOptions 与进行中的 rebuild", () => {
  it("重建期间到达的更新不会被丢弃：最终实例仍应用最新 props", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    // 1) recreate 键 → 触发 rebuild；create 被卡住（未 resolve）
    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();
    expect(harness.result.resource.value).toBeNull();

    // 2) 创建尚未完成时又收到一条 mutable 更新（评审反例：窗口内的第二次更新）
    harness.props.title = "late";
    await harness.result.applyOptions({ title: "late" });

    // 3) 放行创建
    harness.pendingCreates[1].resolve({ id: 2 });
    await rebuildDone;
    await flushPromises();

    const mounted = harness.result.resource.value;
    expect(mounted).not.toBeNull();
    // 最终挂载的实例必须收到窗口内那条更新，否则它就与最新 props 不一致
    expect(harness.setOptionsCalls).toContainEqual({
      instance: { id: 2 },
      options: { title: "late" },
    });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("重建期间的多条更新会合并，且在重建完成后只应用一次", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();

    await harness.result.applyOptions({ title: "a" });
    await harness.result.applyOptions({ zIndex: 9 });

    harness.pendingCreates[1].resolve({ id: 2 });
    await rebuildDone;
    await flushPromises();

    const forNewInstance = harness.setOptionsCalls.filter((c) => c.instance.id === 2);
    expect(forNewInstance).toHaveLength(1);
    expect(forNewInstance[0].options).toEqual({ title: "a", zIndex: 9 });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("重建期间到达的 recreate 更新会在重建完成后补一次重建", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();

    // 窗口内又是一次构造期属性变化：必须再重建一次，否则最终实例仍是旧构造选项
    await harness.result.applyOptions({ enableClicking: true });

    // 放行第一次重建 → 它挂载后补跑待办 → 待办是 recreate → 触发第二次 rebuild（不再 await 前者）
    harness.pendingCreates[1].resolve({ id: 2 });
    await flushPromises();
    await flushPromises();
    expect(harness.pendingCreates).toHaveLength(3);

    harness.pendingCreates[2].resolve({ id: 3 });
    await flushPromises();
    await rebuildDone;
    await flushPromises();

    expect(harness.result.resource.value).toEqual({ id: 3 });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("卸载后到达的更新不排队、不创建", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);
    harness.wrapper.unmount();
    await flushPromises();

    const before = harness.pendingCreates.length;
    await harness.result.applyOptions({ title: "after-unmount" });
    expect(harness.pendingCreates).toHaveLength(before);
    expect(harness.setOptionsCalls).toEqual([]);
  });

  /* ------------------------------------------------------------------ 复审（PR #61 第二轮） */

  it("[复审 P2-1] 挂载回调里的新更新不被旧队列覆盖（新值优先）", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    // 重建在飞
    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();
    // 窗口内先排一条旧值
    await harness.result.applyOptions({ title: "older-pending" });

    // 新实例的挂载回调里同步推一条更新的值（接口允许的同步 addToMap 回调）
    harness.hooks.onAddToMap = (instance) => {
      if (instance.id !== 2) return;
      harness.props.title = "newest-from-attach";
      void harness.result.applyOptions({ title: "newest-from-attach" });
    };

    harness.pendingCreates[1].resolve({ id: 2 });
    await rebuildDone;
    await flushPromises();

    // 最终生效的必须是更新的那个值：旧队列不得再覆盖它
    expect(lastAppliedOn(harness, 2)).toEqual({ title: "newest-from-attach" });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("[复审 P2-1] 首建路径同样「新值优先」：挂载回调的新值不被首建期间的旧值覆盖", async () => {
    const harness = setupHarness();
    await flushPromises(); // onMounted 已发起首建（create 未完成）

    await harness.result.applyOptions({ title: "older-pending" });

    harness.hooks.onAddToMap = (instance) => {
      if (instance.id !== 1) return;
      harness.props.title = "newest-from-attach";
      void harness.result.applyOptions({ title: "newest-from-attach" });
    };

    harness.pendingCreates[0].resolve({ id: 1 });
    await flushPromises();
    await flushPromises();

    expect(lastAppliedOn(harness, 1)).toEqual({ title: "newest-from-attach" });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("[复审 P2] 旧批次重新入队时已有队列中的新值优先（重建被另一轮重建取代）", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    // 1) 一批更新（含构造期属性）触发重建，创建 #2（未完成）
    const firstApply = harness.result.applyOptions({
      enableClicking: false,
      title: "older-from-batch",
    });
    await flushPromises();

    // 2) 等待期间同键的新值入队（两个值都同步写进 props）
    harness.props.title = "newer-pending";
    await harness.result.applyOptions({ title: "newer-pending" });

    // 3) 显式 rebuild 取代 #2，创建 #3
    const explicitRebuild = harness.result.rebuild();
    await flushPromises();
    expect(harness.pendingCreates).toHaveLength(3);

    // 4) 先完成已过期的 #2 → 旧批次被重新入队
    harness.pendingCreates[1].resolve({ id: 2 });
    await firstApply;
    await flushPromises();

    // 5) 放行后续创建并排空队列
    await settleCreates(harness);
    await explicitRebuild;
    await flushPromises();

    const appliedTitles = harness.setOptionsCalls
      .map((call) => call.options.title)
      .filter((title): title is string => typeof title === "string");
    // 旧批次里的旧值不得因为「重新入队」而翻上来覆盖新值
    expect(appliedTitles).not.toContain("older-from-batch");
    expect(appliedTitles.at(-1)).toBe("newer-pending");

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("[复审 P2-2] 同一批含 recreate 时，mutable 值落到最终存活的实例", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();

    // 窗口内的两条更新（命令式 mutable + 构造期属性）会合并成同一批待办
    await harness.result.applyOptions({ title: "imperative-mutable-update" });
    harness.props.enableClicking = true;
    await harness.result.applyOptions({ enableClicking: true });

    harness.pendingCreates[1].resolve({ id: 2 });
    await flushPromises();
    await flushPromises();

    // 待办里含 recreate → 先重建（实例 #3），再把 mutable 写到它身上
    expect(harness.pendingCreates).toHaveLength(3);
    harness.pendingCreates[2].resolve({ id: 3 });
    await flushPromises();
    await rebuildDone;
    await flushPromises();

    expect(lastAppliedOn(harness, 3)).toEqual({ title: "imperative-mutable-update" });
    // 中间实例 #2 不该收到这次 mutable 更新（它随后就被移除了）
    expect(harness.setOptionsCalls.filter((c) => c.instance.id === 2)).toEqual([]);

    harness.wrapper.unmount();
    await flushPromises();
  });
});
