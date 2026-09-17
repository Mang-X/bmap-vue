/**
 * LayerRegistry（M7-LAYERS / issue #40）
 *
 * 这个账本只有三件事要保证，而三件都**不能**从组件级用例里看出来（组件级只观察「地图上
 * 还剩几个图层」）：
 *
 * 1. **幂等**：组件卸载 / 重建 / Map 销毁三条路径交叉触发时，同一个记录只生效一次；
 * 2. **逆序**：`disposeAll()` 后挂的先摘（与 `ResourceScope` 的 disposer 顺序同源）；
 * 3. **每条记录的顺序**：先释放实例 child scope（解绑业务监听）、再摘除 SDK 资源
 *    —— 反过来会让 SDK 在 `removeLayer` 期间同步派发的事件打到正在拆解的业务回调上（#22）。
 */
import { describe, expect, it } from "vitest";
import type { LayerHandle } from "../../driver/types/handles";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { createLayerRegistry } from "./LayerRegistry";

/** 记录发生顺序的探针：`scope` 里挂一个「解绑」动作，`remove` 里记「摘除」。 */
function makeTarget(label: string, order: string[], failRemove = false) {
  const scope = new ResourceScope({ label });
  scope.add(() => order.push(`unbind:${label}`));
  const handle = { raw: {} } as unknown as LayerHandle;
  const remove = () => {
    order.push(`remove:${label}`);
    if (failRemove) throw new Error("removeLayer failed");
  };
  return { scope, handle, remove };
}

describe("LayerRegistry 的记账与释放", () => {
  it("记录 kind / handle，size 与 kinds() 反映当前登记项", () => {
    const registry = createLayerRegistry();
    expect(registry.size).toBe(0);
    expect(registry.kinds()).toEqual([]);

    const a = makeTarget("a", []);
    const b = makeTarget("b", []);
    registry.register({ kind: "tile", ...a });
    registry.register({ kind: "geojson", ...b });

    expect(registry.size).toBe(2);
    expect(registry.kinds()).toEqual(["tile", "geojson"]);
  });

  it("单条记录：先解绑业务监听、再摘除 SDK 资源；重复 dispose 只生效一次", () => {
    const order: string[] = [];
    const registry = createLayerRegistry();
    const record = registry.register({ kind: "tile", ...makeTarget("a", order) });

    expect(record.disposed).toBe(false);
    record.dispose();
    expect(order).toEqual(["unbind:a", "remove:a"]);
    expect(record.disposed).toBe(true);
    expect(registry.size).toBe(0);

    // 幂等：第二次调用不再触碰 SDK（否则会把「重复摘除」变成对整个 Map 的额外调用）
    record.dispose();
    expect(order).toEqual(["unbind:a", "remove:a"]);
  });

  it("disposeAll：逆序摘除，且清空账本", () => {
    const order: string[] = [];
    const registry = createLayerRegistry();
    registry.register({ kind: "tile", ...makeTarget("first", order) });
    registry.register({ kind: "traffic", ...makeTarget("second", order) });
    registry.register({ kind: "geojson", ...makeTarget("third", order) });

    registry.disposeAll();

    expect(order).toEqual([
      "unbind:third",
      "remove:third",
      "unbind:second",
      "remove:second",
      "unbind:first",
      "remove:first",
    ]);
    expect(registry.size).toBe(0);

    // 幂等：再调一次不产生任何动作
    registry.disposeAll();
    expect(order).toHaveLength(6);
  });

  it("摘除失败不阻断其余记录的释放（但错误不静默：由 SDK 侧的可观测性承担）", () => {
    const order: string[] = [];
    const registry = createLayerRegistry();
    registry.register({ kind: "tile", ...makeTarget("failing", order, true) });
    registry.register({ kind: "tile", ...makeTarget("healthy", order) });

    expect(() => registry.disposeAll()).not.toThrow();
    expect(order).toEqual([
      "unbind:healthy",
      "remove:healthy",
      "unbind:failing",
      "remove:failing",
    ]);
    expect(registry.size).toBe(0);
  });

  it("已经 dispose 的记录不会被 disposeAll 再摘一次（组件先卸载、Map 后销毁的常见顺序）", () => {
    const order: string[] = [];
    const registry = createLayerRegistry();
    const record = registry.register({ kind: "tile", ...makeTarget("a", order) });
    record.dispose();
    registry.disposeAll();
    expect(order).toEqual(["unbind:a", "remove:a"]);
  });
});
