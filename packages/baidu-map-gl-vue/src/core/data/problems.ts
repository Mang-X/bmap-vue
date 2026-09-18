/**
 * 数据问题的**聚合上报**（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * 「跳过坏数据」这件事在三条数据路径上都会发生（逐项 Marker / 聚合 / 批量 GeoJSON），而它们
 * 共用的判定在 `./itemScan.ts`。本模块是那三处**共用的一半**：把逐项问题按**原因**聚合成
 * 一条开发期告警。
 *
 * 为什么不逐项打日志：数据驱动的组件里，一条坏数据往往意味着一整批坏数据（字段改名、坐标列错位），
 * 逐项刷日志会把控制台填满，反而看不见问题的形状。因此按 `kind` 聚合：
 *
 * - 第一次出现**立刻**报（单条坏数据不该等到「下一批」才被看见）；
 * - 之后只累加计数，计数增长后由 `flush()` 补一条最新的总数（不重复刷同样的数字）；
 * - 没有问题时一次都不报（`flush()` 也一样）。
 *
 * 它刻意不 import 任何组件 / Vue / Driver：诊断口径与渲染无关，测试可以直接驱动。
 */
import type { ItemProblem, ItemProblemKind } from "./itemScan";

/**
 * 数据问题的全部原因码。
 *
 * 前三条来自扫描（`itemScan` 的 `ItemProblemKind`），最后一条只有 GeoJSON 适配层会产生
 * （`properties()` 里写了 id 字段 —— 那个字段是**要素身份**，不允许被覆盖）。
 */
export type DataProblemKind = ItemProblemKind | "id-field-overwritten";

/** 逐项问题；`index` 是**入参数组**里的下标，`key` 在能取到时带上。 */
export type DataProblem = Omit<ItemProblem, "kind"> & { readonly kind: DataProblemKind };

export interface ProblemReporter {
  report(problem: DataProblem): void;
  /** 把已累计但还没报出的计数补齐。 */
  flush(): void;
}

export function createProblemReporter(
  label: string,
  warn: (message: string, context?: Record<string, unknown>) => void,
): ProblemReporter {
  interface Entry {
    count: number;
    first: DataProblem;
    /** 已经报出过的计数：`flush()` 只在计数增长时补一条，不重复刷同样的数字。 */
    emitted: number;
  }
  const entries = new Map<DataProblemKind, Entry>();

  const emit = (kind: DataProblemKind): void => {
    const entry = entries.get(kind);
    if (!entry || entry.emitted >= entry.count) return;
    entry.emitted = entry.count;
    warn(
      `[${label}] ${PROBLEM_LABELS[kind]}：共 ${entry.count} 项（首次出现在下标 ${entry.first.index}${
        entry.first.key === undefined ? "" : `，key=${String(entry.first.key)}`
      }）——${entry.first.detail}`,
    );
  };

  return {
    report(problem) {
      const entry = entries.get(problem.kind);
      if (entry) {
        entry.count += 1;
        return;
      }
      // 第一次出现立刻报：单条坏数据不该等到「下一批」才被看见。
      entries.set(problem.kind, { count: 1, first: problem, emitted: 0 });
      emit(problem.kind);
    },
    flush() {
      for (const kind of entries.keys()) emit(kind);
    },
  };
}

const PROBLEM_LABELS: Record<DataProblemKind, string> = {
  "missing-key": "itemKey 取不到可用的 key",
  "duplicate-key": "itemKey 重复",
  "invalid-position": "getPosition 不是合法坐标",
  "id-field-overwritten": "properties() 覆盖了要素身份字段",
};
