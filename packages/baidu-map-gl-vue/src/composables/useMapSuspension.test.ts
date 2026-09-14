/**
 * 容器门禁与可见性暂停策略（M4-HANDLE-UX / issue #29）
 *
 * 这一层测的是**策略**（环境信号 → 暂停原因 / 门禁放行），因此用最小替身当 target：
 * 真正的「原因集合 → 是否恢复 / 是否补偿 checkResize」在 `core/runtime/MapRuntime.test.ts`，
 * 端到端行为在 `tests/behavior/v3-component-scenarios.test.ts`（那里的 target 是真的 MapRuntime）。
 *
 * 覆盖四类容易只测 happy path 的点：
 * 1. **门禁只放行一次**，且放行之前**不**请求尺寸校正（零尺寸建图与多余命令都不该发生）；
 * 2. **恢复只减自己那一个原因**（`resume("document")` 不得等于「恢复一切」）；
 * 3. **未知不当作不可见**（视口初值乐观），否则不支持 IntersectionObserver 的环境一上来就暂停；
 * 4. **dispose 之后**迟到的回调不再触碰 target，且观察器真的被断开。
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick, shallowRef, type ShallowRef } from "vue";
import { browserShims, createManualFrames } from "../../../test-utils";
import type { MapSuspendReason } from "../core/runtime/suspension";
import { useMapSuspension } from "./useMapSuspension";

const shims = browserShims();

interface TargetDouble {
  suspension: ShallowRef<readonly MapSuspendReason[]>;
  requestResize: ReturnType<typeof vi.fn>;
  suspendCalls: MapSuspendReason[];
  resumeCalls: MapSuspendReason[];
  suspend(reason: MapSuspendReason): void;
  resume(reason: MapSuspendReason): void;
}

/** 最小 target：只维护原因集合与调用记录（`MapRuntime` 的真实语义见它自己的用例）。 */
function createTarget(): TargetDouble {
  const suspension = shallowRef<readonly MapSuspendReason[]>([]);
  const suspendCalls: MapSuspendReason[] = [];
  const resumeCalls: MapSuspendReason[] = [];
  return {
    suspension,
    requestResize: vi.fn(),
    suspendCalls,
    resumeCalls,
    suspend(reason) {
      suspendCalls.push(reason);
      if (!suspension.value.includes(reason)) suspension.value = [...suspension.value, reason];
    },
    resume(reason) {
      resumeCalls.push(reason);
      suspension.value = suspension.value.filter((current) => current !== reason);
    },
  };
}

/** 造一个可控容器（盒模型由替身按显式尺寸给出）。 */
function createContainer(size: { width: number; height: number } = { width: 320, height: 240 }) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  shims.setElementSize(element, size);
  return element;
}

function setup(
  options: {
    size?: { width: number; height: number };
    autoResize?: () => boolean;
  } = {},
) {
  const container = createContainer(options.size);
  const target = createTarget();
  const onContainerReady = vi.fn();
  const controller = useMapSuspension({
    target,
    measure: () => container,
    onContainerReady,
    autoResize: options.autoResize,
  });
  return { container, target, onContainerReady, controller };
}

describe("useMapSuspension：容器门禁", () => {
  it("begin() 同步测量：可用 ⇒ 放行一次；重复 begin() 不重复回调", () => {
    const { onContainerReady, controller } = setup();
    controller.begin();
    expect(controller.containerReady.value).toBe(true);
    expect(onContainerReady).toHaveBeenCalledTimes(1);
    expect(controller.size.value).toEqual({ width: 320, height: 240 });

    controller.begin();
    expect(onContainerReady, "门禁只放行一次").toHaveBeenCalledTimes(1);
  });

  it("零尺寸不放行；拿到非零尺寸后放行一次，且放行前不请求尺寸校正", () => {
    const { container, target, onContainerReady, controller } = setup({
      size: { width: 0, height: 0 },
    });
    controller.begin();
    expect(controller.containerReady.value).toBe(false);
    expect(onContainerReady).not.toHaveBeenCalled();

    // 展开动画的中间帧：只有宽度到位、高度还是 0 —— 这一步仍然不算放行
    shims.resize(container, { width: 320, height: 0 });
    expect(controller.containerReady.value).toBe(false);
    expect(target.requestResize).not.toHaveBeenCalled();

    shims.resize(container, { width: 320, height: 240 });
    expect(controller.containerReady.value).toBe(true);
    expect(onContainerReady).toHaveBeenCalledTimes(1);
    expect(
      target.requestResize,
      "放行那一次不额外请求（建图自己会应用首次视野）",
    ).not.toHaveBeenCalled();
  });

  it("放行之后的尺寸变化请求一次合帧校正；相同尺寸不请求", () => {
    const { container, target, controller } = setup();
    controller.begin();

    shims.resize(container, { width: 320, height: 240 });
    expect(target.requestResize, "尺寸没变 ⇒ 不请求").not.toHaveBeenCalled();

    shims.resize(container, { width: 400, height: 300 });
    expect(target.requestResize).toHaveBeenCalledTimes(1);
  });

  it("autoResize 返回 false 时只更新读数、不请求校正", () => {
    const { container, target, controller } = setup({ autoResize: () => false });
    controller.begin();
    shims.resize(container, { width: 400, height: 300 });
    expect(controller.size.value).toEqual({ width: 400, height: 300 });
    expect(target.requestResize).not.toHaveBeenCalled();
  });
});

describe("useMapSuspension：可见性原因", () => {
  it("页面隐藏挂 document 原因，恢复可见只移除 document", () => {
    const { target, controller } = setup();
    controller.begin();

    shims.setDocumentHidden(true);
    expect(target.suspendCalls).toEqual(["document"]);
    expect(controller.documentVisible.value).toBe(false);

    shims.setDocumentHidden(false);
    expect(target.resumeCalls).toEqual(["document"]);
    expect(controller.documentVisible.value).toBe(true);
  });

  it("视口默认乐观（未知不当作不可见），明确离开才挂 offscreen", () => {
    const { container, target, controller } = setup();
    controller.begin();
    expect(controller.intersectVisible.value, "初值乐观").toBe(true);

    shims.intersect(container, false);
    expect(target.suspendCalls).toEqual(["offscreen"]);
    expect(controller.intersectVisible.value).toBe(false);

    shims.intersect(container, false);
    expect(target.suspendCalls, "重复的同一结论不重复挂原因").toEqual(["offscreen"]);

    shims.intersect(container, true);
    expect(target.resumeCalls).toEqual(["offscreen"]);
  });

  it("减少动画只更新只读信号，不触碰暂停原因", () => {
    const { target, controller } = setup();
    controller.begin();
    expect(controller.reducedMotion.value).toBe(false);

    shims.setReducedMotion(true);
    expect(controller.reducedMotion.value).toBe(true);
    expect(target.suspendCalls).toEqual([]);
    expect(controller.suspendedReasons.value).toEqual([]);

    shims.setReducedMotion(false);
    expect(controller.reducedMotion.value).toBe(false);
  });

  it("suspendedReasons 与 target 的读数同源", () => {
    const { target, controller } = setup();
    controller.begin();
    target.suspend("document");
    target.suspend("user");
    expect(controller.suspendedReasons.value).toEqual(["document", "user"]);
  });
});

describe("useMapSuspension：释放", () => {
  it("容器引用替换：旧元素的信号不再进来，旧观察器被断开", async () => {
    const first = createContainer({ width: 320, height: 240 });
    const second = createContainer({ width: 320, height: 240 });
    // 用 ref 而不是普通变量：观察器跟着 getter 的**响应式依赖**换元素，
    // 这也是 `<BMap>` 的真实形态（`measure: () => rootRef.value`）
    const current = shallowRef<HTMLElement>(first);
    const target = createTarget();
    const controller = useMapSuspension({
      target,
      measure: () => current.value,
      onContainerReady: vi.fn(),
    });
    controller.begin();
    const disconnectsBefore = shims.diagnostics().resizeDisconnects;

    // 换容器：VueUse 的 `useResizeObserver` 用 `watch(..., { flush: "post" })` 重新 observe，
    // 因此要等一个 tick 才生效
    current.value = second;
    await nextTick();

    shims.resize(first, { width: 500, height: 500 });
    expect(target.requestResize, "旧元素的尺寸变化不该再触发任何请求").not.toHaveBeenCalled();

    shims.resize(second, { width: 500, height: 500 });
    expect(target.requestResize, "新元素的尺寸变化正常触发").toHaveBeenCalledTimes(1);
    expect(
      shims.diagnostics().resizeDisconnects,
      "旧观察器必须被断开（不是留着继续观察旧元素）",
    ).toBeGreaterThan(disconnectsBefore);
  });

  it("dispose 断开观察器，迟到的信号不再触碰 target", () => {
    const { container, target, controller } = setup();
    controller.begin();
    const before = shims.diagnostics();

    controller.dispose();
    const after = shims.diagnostics();
    expect(after.resizeObservers, "尺寸观察器被释放").toBeLessThanOrEqual(before.resizeObservers);
    expect(after.resizeDisconnects, "释放路径调用了 disconnect").toBeGreaterThan(0);

    const callsAfterDispose = target.suspendCalls.length;
    shims.setDocumentHidden(true);
    shims.intersect(container, false);
    shims.resize(container, { width: 500, height: 500 });
    expect(target.suspendCalls.length, "dispose 之后不再记账").toBe(callsAfterDispose);
    expect(target.requestResize, "dispose 之后不再请求尺寸校正").not.toHaveBeenCalled();
  });

  it("dispose 是幂等的（重复调用不抛错）", () => {
    const { controller } = setup();
    controller.begin();
    expect(() => {
      controller.dispose();
      controller.dispose();
    }).not.toThrow();
  });
});

describe("useMapSuspension：不自己排帧", () => {
  it("策略层不占用 RAF（只委托 target.requestResize）", () => {
    const frames = createManualFrames();
    frames.install();
    try {
      const { container, controller } = setup();
      controller.begin();
      shims.resize(container, { width: 400, height: 300 });
      expect(frames.pending(), "策略层不占用 RAF").toBe(0);
    } finally {
      frames.restore();
    }
  });
});
