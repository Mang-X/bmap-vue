/**
 * Control / Layer 资源卸载顺序（M3A2-CONTROLS-LAYERS / issue #22 实施步骤 4）
 *
 * 「确保 remove 先解绑业务事件，再由 Map 移除资源」是 issue 的实施要求，而它分别落在
 * `useControlResource` 与 `useLayerResource`（图层经内核的 `LayerRecord.dispose()`）的卸载路径上
 * ——组件的业务监听器都经 `scope.add(...)` 注册（`BLocation` 的 locationSuccess/locationError、
 * `BDistrictLayer` 的 click/mouseover/mouseout）。
 *
 * 这条顺序无法从组件级测试的外部行为观察，因此这里用一个**最小 MapContext 替身** + 记账 spec
 * 把它变成可断言的事实：卸载时必须是 `unbind → sdk-remove`，否则 SDK 在 `removeControl` /
 * `removeLayer` 期间同步派发的事件会打到正在拆解的业务回调上。
 *
 * M7-CONTROL-PANORAMA（#41）之后控件侧改成 `ControlSpec` + `useSdkResource`，而 `useSdkResource`
 * 的默认顺序是「先 registration.dispose、再 instanceScope.dispose」——正好与要求相反。因此该用例
 * 是**防止那次重构把顺序改回去**的回归门禁：适配器必须在 registration 的 `dispose()` 里自己先
 * `scope.dispose()`。
 *
 * 图层一侧（M7-LAYERS / #40）的替身是「最小 LayerDriver」：内核只用它六个成员
 * （`create` / `add` / `remove` / `surface` / `isMutableOption` / `supports`），而业务监听器写在
 * `bind()` 里、挂在**本代的 child scope** 上，因此「scope 先于 SDK 摘除」这条在图层侧是
 * `LayerRecord.dispose()` 的职责。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide } from "vue";
import type { MapContext, MapReadyContext } from "../context/types";
import { mapContextInjectionKey } from "../context/inject";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";
import type { ControlDriver } from "../../driver/types/controls";
import { useControlResource } from "../controls/useControlResource";
import type { ControlSpec } from "../controls/spec";
import type { LayerHandle } from "../../driver/types/handles";
import type { LayerDriver, LayerKind } from "../../driver/types/layers";
import { useLayerResource, type LayerResourceHooks } from "./useLayerResource";

/** 卸载过程中记录到的动作顺序。 */
let order: string[] = [];

/** 控件侧的最小 Driver：只记 add / remove 的顺序，其余成员不会在本用例里被调用。 */
function recordingControls(): ControlDriver {
  const unused = (): never => {
    throw new Error("本用例不应调用该成员");
  };
  return {
    create: () => ({ raw: {} }) as ControlHandle,
    createCustomControl: () => ({ raw: {} }) as ControlHandle,
    add: () => {
      order.push("add-to-map");
    },
    remove: () => {
      order.push("sdk-remove");
    },
    show: () => {},
    hide: () => {},
    setOptions: unused,
    planOptions: () => ({}),
    addCopyright: unused,
    removeCopyright: unused,
    listCopyrights: () => [],
  };
}

/** 最小 LayerDriver 替身：只记账 + 提供内核需要的能力面。 */
function fakeLayerDriver(): LayerDriver {
  return {
    create: (kind: LayerKind) => {
      order.push(`create:${kind}`);
      return { raw: {} } as unknown as LayerHandle;
    },
    add: () => order.push("add-to-map"),
    // 与真实 Driver 同形：`remove` 成功返回之后才销账。这里只记顺序，本用例不注入失败。
    remove: () => order.push("sdk-remove"),
    setOptions: () => {},
    surface: () => ({ ctorSlots: [], operations: [] }),
    supports: () => false,
    isMutableOption: () => false,
    // 本用例只数「谁先谁后」：没有清空能力 ⇒ 恒 false（调用方应先判 supports）。
    clearRequiresAttach: () => false,
    setZIndex: () => {},
    setData: () => {},
    clearData: () => {},
  };
}

/**
 * 最小 MapContext 替身：只满足这两个 composable 真正用到的成员（`whenReady` / `events.emit` /
 * `client.driver`），其余按类型断言补齐——测的是卸载顺序，不是 context。
 *
 * 两条路径都要能跑，所以 Driver 里同时给出 `controls` 与 `layers`。
 */
function fakeMapContext(): never {
  const ready: MapReadyContext = {
    client: {
      driver: { controls: recordingControls(), layers: fakeLayerDriver() },
    } as unknown as MapReadyContext["client"],
    map: { raw: {} } as MapReadyContext["map"],
  };
  return {
    whenReady: async () => ready,
    events: { emit: () => {} },
  } as never;
}

beforeEach(() => {
  order = [];
});

/** 业务事件/副作用：与组件里 `scope.add(events.on(res, ...))` 同形。 */
const registerBusinessEvent = (scope: ResourceScope): ControlHandle => {
  scope.add(() => order.push("unbind"));
  return { raw: {} } as ControlHandle;
};

const CONTROL_SPEC: ControlSpec<{ anchor?: string; offset?: { x: number; y: number } }> = {
  kind: "zoom",
  options: () => ({}),
  create: ({ scope }) => registerBusinessEvent(scope),
};

/**
 * 图层侧与组件的 `bind` 同形：监听器挂在本代的 child scope 上（不是 `create` 里）。
 *
 * 这是刻意的：`bind` 是「这一代实例的监听归属」的唯一入口，重建时旧 scope 随旧实例释放。
 */
const LAYER_HOOKS: LayerResourceHooks<Record<string, never>> = {
  toSpec: () => ({ kind: "tile" }),
  component: "ProbeLayer",
  bind: ({ scope }) => {
    scope.add(() => order.push("unbind"));
  },
};

function mountWith(use: "control" | "layer") {
  const Child = defineComponent({
    name: use === "control" ? "ProbeControl" : "ProbeLayer",
    setup() {
      if (use === "control") {
        useControlResource({}, CONTROL_SPEC);
      } else {
        useLayerResource({} as Record<string, never>, LAYER_HOOKS);
      }
      return () => null;
    },
  });

  return mount(
    defineComponent({
      setup() {
        provide(mapContextInjectionKey, fakeMapContext());
        return () => h(Child);
      },
    }),
  );
}

describe.each([
  // 图层多一步 `create:<kind>`：内核的创建是显式的一次 SDK 调用（控件侧走 `controls.create`，
  // 由 Driver 内部完成，不在本用例的日记里）。
  ["useControlResource", "control", ["add-to-map"], ["add-to-map", "unbind", "sdk-remove"]],
  [
    "useLayerResource",
    "layer",
    ["create:tile", "add-to-map"],
    ["create:tile", "add-to-map", "unbind", "sdk-remove"],
  ],
] as const)("%s 的卸载顺序", (_name, composable, afterMount, afterUnmount) => {
  it("先解绑业务事件，再由 Map 移除资源", async () => {
    const wrapper = mountWith(composable);
    await flushPromises();
    expect(order).toEqual([...afterMount]);

    wrapper.unmount();
    await flushPromises();

    expect(order).toEqual([...afterUnmount]);
  });
});
