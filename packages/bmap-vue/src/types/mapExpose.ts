/**
 * `MapExpose` —— `<Map>` 组件对外冻结的命令式接口（M4-HANDLE-UX / issue #29）
 *
 * ## 两个「句柄」的分工（命名对照，改名前请先读这里）
 *
 * | 名字 | 归属 | 形状 | 怎么拿到 | 用途 |
 * | --- | --- | --- | --- | --- |
 * | `MapHandle` | Driver 层（SDK 侧句柄） | `SdkHandle<"map">`：品牌 + `raw` | `ready` 载荷 / `useMapContext().map` / `MapExpose.getMapInstance()` | 交给 Facet Driver 用；raw SDK 对象经 `./advanced` 的 `unwrapRaw()` |
 * | `MapExpose`（本文件） | 组件层（用户侧命令面） | 常用命令 + 生命周期 | `<Map ref>` / `defineExpose()` | 业务在父组件里下命令、订阅就绪、重试加载 |
 *
 * issue #29 把两者都写了「MapHandle / MapExpose」这个名字对：**driver 句柄保持精简**
 * （它只是一个品牌 + raw，不挂任何方法 —— 一旦挂上方法就会被组件、Driver、Fake 三处同时消费，
 * 再也改不动），**用户侧命令面单独定型**。所以本文件不引入新的「`MapHandle` 同名物」，
 * 也不把 `useViewAnimation` 一类内部代码依赖的 `getMapInstance()` 改名。
 *
 * ## 冻结面
 *
 * 这里列出的成员就是**发布的接口**：`MapCommands` 的 14 条常用命令 + 组件级命令。
 * 增删成员都要走 ADR（`2026-09-14-map-handle-container-and-visibility` 冻结了这版）。
 * 明确**不属于**这一层的：raw SDK 对象（`./advanced` 的逃生口）、完整 `BMap.Map` 方法表
 * （issue #29 非目标）、内部 Runtime（业务不需要监听它就知道加载 / 错误状态 —— 那是
 * `#loading` / `#error` 插槽与 `retry()` 的职责）。
 */
import type { MapReadyContext } from "../core/context/types";
import type { MapCommands } from "../core/runtime/mapCommands";
import type { MapSuspendReason } from "../core/runtime/suspension";
import type { MapHandle } from "../driver/types/handles";

/**
 * `<Map>` 的 expose 形状。
 *
 * 组件里的实现由 `createExpose()` 返回**显式标注为本类型**的对象，
 * 因此 `defineExpose()` 推导出的实例类型就是它（`InstanceType<typeof Map>`），
 * 消费方（含 `fixtures/consumer` 的真实 tarball 类型检查）能拿到逐成员的类型。
 */
export interface MapExpose extends MapCommands {
  /* ------------------------------------------------------------------ 容器 */
  /** 地图容器 DOM（SDK 在其内部创建 canvas；`null` = 尚未挂载）。 */
  getContainer(): HTMLElement | null;
  /**
   * 容器是否**已经拿到非零尺寸**（也就是「地图是否已被放行创建」）。
   *
   * 与 `status` 的关系：容器零尺寸期间 `status` 仍停在 `idle`（不会进入加载流程），
   * 因此「我等了半天怎么还没加载」与「容器还没展开」在这里可以区分开。
   */
  isContainerReady(): boolean;
  /** 容器尺寸变化后手动重设地图尺寸（自动路径由 `enableAutoResize` 控制）。 */
  checkResize(): void;

  /* ------------------------------------------------------------------ 生命周期 */
  /** SDK map 句柄（driver 层；raw SDK 对象请走 `./advanced` 的 `unwrapRaw()`）。 */
  getMapInstance(): MapHandle | null;
  /** 就绪（`ready`）后 resolve；可传 `AbortSignal` 只取消**本次等待**。 */
  whenReady(signal?: AbortSignal): Promise<MapReadyContext>;
  /** 建图成功、初始化视野**之前**的挂载点（订阅 `load` 这类初始化期事件用）。 */
  whenMapCreated(callback: (ready: MapReadyContext) => void): () => void;
  /** 承载地图的组件是否已开始卸载（早于子树卸载）。 */
  isTearingDown(): boolean;
  /**
   * 重试加载：**返回的 Promise 就是「这一次重试的结果」**。
   *
   * - 已就绪：立刻 resolve 当前上下文（幂等：不重跑装配、不重复广播 `ready`）；
   * - 已有一次启动在飞：返回**同一个** Promise（并发 `retry()` 不会重复广播 / 重复加载插件）；
   * - 容器当前不可用（Tab / Drawer 收起）：**不建图**，Promise 保持 **pending**，直到容器恢复、
   *   这次重试真正执行完才 settle。
   */
  retry(): Promise<MapReadyContext>;

  /* ------------------------------------------------------------------ 暂停策略 */
  /**
   * 加一个暂停原因（默认 `"user"`）。
   *
   * 暂停期间：容器尺寸变化不触发 `checkResize`、合帧任务不提交（保留每个 key 的最后一次）。
   * **不销毁地图**、也不移除覆盖物。
   */
  suspend(reason?: MapSuspendReason): void;
  /**
   * 移除**一个**暂停原因（默认 `"user"`）。
   *
   * 只有原因集合变空才真正恢复并补偿一次 `checkResize()` —— 因此「页面恢复可见」
   * 不会顺手把用户的手动暂停一起解除。
   */
  resume(reason?: MapSuspendReason): void;
  /** 当前是否有任一暂停原因生效。 */
  isSuspended(): boolean;
  /** 当前生效的暂停原因（诊断用；返回快照，不是活集合）。 */
  suspendReasons(): readonly string[];

  /* ------------------------------------------------------------------ 视野 / 交互 */
  /** 把视野移回**首次快照**，并同步重置四个内部状态（不再有 `resetCenter` 别名）。 */
  resetView(): void;
  /** 设置地图是否可拖动（`driver.map.setInteraction` 的薄封装）。 */
  setDragging(enabled: boolean): void;

  /* ------------------------------------------------------------------ 环境偏好 */
  /**
   * 当前的「减少动画」偏好（`prefers-reduced-motion: reduce`）。
   *
   * **只读信号**：它不会暂停地图、也不会阻断任何必要的数据更新 —— 只供**可选动画**
   * 决定要不要跳过。本库的 `<Map>` 自身没有可选动画（首次视野一直是 `noAnimation`），
   * 因此它是暴露给调用方的，不是组件内部用来停任务的开关。
   */
  prefersReducedMotion(): boolean;
}
