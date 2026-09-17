/**
 * Control / Layer 资源卸载顺序（M3A2-CONTROLS-LAYERS / issue #22 实施步骤 4）
 *
 * 「确保 remove 先解绑业务事件，再由 Map 移除资源」是 issue 的实施要求，而它分别落在
 * `useControlResource` 的 `onUnmounted` 与图层内核的 `LayerRecord.dispose()` 上（组件的业务
 * 监听器都经 scope 注册——`BLocation` 的 locationSuccess/locationError、
 * `BDistrictLayer` 的 click/mouseover/mouseout）。
 *
 * 这条顺序无法从组件级测试的外部行为观察，因此这里用**最小替身**把顺序变成可断言的事实：
 * 卸载时必须是 `unbind → sdk-remove`，否则 SDK 在 `removeControl` / `removeLayer` 期间同步
 * 派发的事件会打到正在拆解的业务回调上。
 *
 * 图层一侧（M7-LAYERS / #40）的替身是「最小 LayerDriver」：内核只用它六个成员
 * （`create` / `add` / `remove` / `surface` / `isMutableOption` / `supports`）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide } from "vue";
import type { MapContext, MapReadyContext } from "../context/types";
import { mapContextInjectionKey } from "../context/inject";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import type { LayerHandle } from "../../driver/types/handles";
import type { LayerDriver, LayerKind } from "../../driver/types/layers";
import { useControlResource } from "./useControlResource";
import { useLayerResource } from "./useLayerResource";

/** 卸载过程中记录到的动作顺序。 */
let order: string[] = [];

/** 最小 LayerDriver 替身：只记账 + 提供内核需要的能力面。 */
function fakeLayerDriver(): LayerDriver {
  return {
    create: (kind: LayerKind) => {
      order.push(`create:${kind}`);
      return { raw: {} } as unknown as LayerHandle;
    },
    add: () => order.push("add-to-map"),
    remove: () => order.push("sdk-remove"),
    setOptions: () => {},
    surface: () => ({ ctorSlots: [], operations: [] }),
    supports: () => false,
    isMutableOption: () => false,
    setZIndex: () => {},
    setData: () => {},
    clearData: () => {},
  };
}

/**
 * 最小 MapContext 替身：只满足这两个 composable 真正用到的成员（`whenReady` / `events.emit` /
 * `client.driver`），其余按类型断言补齐——测的是卸载顺序，不是 context。
 */
function fakeMapContext(): never {
  const ready: MapReadyContext = {
    client: {
      driver: {
        layers: fakeLayerDriver(),
        // 业务监听器：释放顺序要能够在同一份日记里对比
        events: { on: () => () => order.push("unbind") },
      },
    } as unknown as MapReadyContext["client"],
    map: { raw: {} } as MapReadyContext["map"],
  };
  const context: Partial<MapContext> = {
    whenReady: async () => ready,
    events: { emit: () => {} } as unknown as MapContext["events"],
  };
  return context as never;
}

beforeEach(() => {
  order = [];
});

const ADAPTER_STEPS = {
  create: (_ctx: unknown, _props: unknown, scope: ResourceScope) => {
    // 业务事件/副作用：与组件里 `scope.add(events.on(res, ...))` 同形
    scope.add(() => order.push("unbind"));
    return { id: "resource" };
  },
  remove: () => {
    order.push("sdk-remove");
  },
};

function mountControlChild() {
  const Child = defineComponent({
    name: "ProbeControl",
    setup() {
      useControlResource({} as Record<string, never>, {
        create: ADAPTER_STEPS.create,
        addToMap: () => order.push("add-to-map"),
        remove: ADAPTER_STEPS.remove,
      });
      return () => null;
    },
  });
  return mountHost(Child);
}

function mountLayerChild() {
  const Child = defineComponent({
    name: "ProbeLayer",
    setup() {
      useLayerResource({} as Record<string, never>, {
        toSpec: () => ({ kind: "tile" }),
        component: "ProbeLayer",
        bind: ({ scope }) => {
          // 与组件的 `bind` 同形：监听器挂在本代的 child scope 上
          scope.add(() => order.push("unbind"));
        },
      });
      return () => null;
    },
  });
  return mountHost(Child);
}

function mountHost(child: ReturnType<typeof defineComponent>) {
  return mount(
    defineComponent({
      setup() {
        provide(mapContextInjectionKey, fakeMapContext());
        return () => h(child);
      },
    }),
  );
}

describe("useControlResource 的卸载顺序", () => {
  it("先解绑业务事件，再由 Map 移除资源", async () => {
    const wrapper = mountControlChild();
    await flushPromises();
    expect(order).toEqual(["add-to-map"]);

    wrapper.unmount();
    await flushPromises();

    expect(order).toEqual(["add-to-map", "unbind", "sdk-remove"]);
  });
});

describe("图层内核的卸载顺序（M7-LAYERS / #40）", () => {
  it("先解绑业务事件，再由 Map 移除资源", async () => {
    const wrapper = mountLayerChild();
    await flushPromises();
    expect(order).toEqual(["create:tile", "add-to-map"]);

    wrapper.unmount();
    await flushPromises();

    expect(order).toEqual(["create:tile", "add-to-map", "unbind", "sdk-remove"]);
  });
});
