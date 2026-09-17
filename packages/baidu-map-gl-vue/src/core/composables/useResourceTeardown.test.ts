/**
 * Control / Layer 资源卸载顺序（M3A2-CONTROLS-LAYERS / issue #22 实施步骤 4）
 *
 * 「确保 remove 先解绑业务事件，再由 Map 移除资源」是 issue 的实施要求，而它落在
 * `useControlResource` / `useLayerResource` 的卸载路径上（组件的业务监听器都经 `scope.add(...)`
 * 注册——`BLocation` 的 locationSuccess/locationError、`BDistrictLayer` 的
 * click/mouseover/mouseout）。
 *
 * 这条顺序无法从组件级测试的外部行为观察，因此这里用一个**最小 MapContext 替身** +
 * 记账 spec 把它变成可断言的事实：卸载时必须是 `unbind → sdk-remove`，
 * 否则 SDK 在 `removeControl` / `removeLayer` 期间同步派发的事件会打到正在拆解的业务回调上。
 *
 * M7-CONTROL-PANORAMA（#41）之后控件侧改成 `ControlSpec` + `useSdkResource`，而
 * `useSdkResource` 的默认顺序是「先 registration.dispose、再 instanceScope.dispose」——
 * 正好与要求相反。因此该用例是**防止那次重构把顺序改回去**的回归门禁：适配器必须在
 * registration 的 `dispose()` 里自己先 `scope.dispose()`。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide } from "vue";
import type { MapReadyContext } from "../context/types";
import { mapContextInjectionKey } from "../context/inject";
import { ResourceScope } from "../lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";
import type { ControlDriver } from "../../driver/types/controls";
import { useControlResource } from "../controls/useControlResource";
import type { ControlSpec } from "../controls/spec";
import { useLayerResource } from "./useLayerResource";

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

/**
 * 最小 MapContext 替身：只满足这两个 composable 真正用到的成员，
 * 其余按类型断言补齐——测的是卸载顺序，不是 context。
 */
function fakeMapContext(): never {
  const ready: MapReadyContext = {
    client: { driver: { controls: recordingControls() } } as unknown as MapReadyContext["client"],
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

const LAYER_ADAPTER_STEPS = {
  create: (_ctx: unknown, _props: unknown, scope: ResourceScope) => {
    scope.add(() => order.push("unbind"));
    return { id: "resource" };
  },
  addToMap: () => order.push("add-to-map"),
  remove: () => {
    order.push("sdk-remove");
  },
};

const CONTROL_SPEC: ControlSpec<{ anchor?: string; offset?: { x: number; y: number } }> = {
  kind: "zoom",
  options: () => ({}),
  create: ({ scope }) => registerBusinessEvent(scope),
};

function mountWith(use: "control" | "layer") {
  const Child = defineComponent({
    name: use === "control" ? "ProbeControl" : "ProbeLayer",
    setup() {
      if (use === "control") {
        useControlResource({}, CONTROL_SPEC);
      } else {
        useLayerResource({} as Record<string, never>, LAYER_ADAPTER_STEPS);
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
  ["useControlResource", "control"],
  ["useLayerResource", "layer"],
] as const)("%s 的卸载顺序", (_name, composable) => {
  it("先解绑业务事件，再由 Map 移除资源", async () => {
    const wrapper = mountWith(composable);
    await flushPromises();
    expect(order).toEqual(["add-to-map"]);

    wrapper.unmount();
    await flushPromises();

    expect(order).toEqual(["add-to-map", "unbind", "sdk-remove"]);
  });
});
