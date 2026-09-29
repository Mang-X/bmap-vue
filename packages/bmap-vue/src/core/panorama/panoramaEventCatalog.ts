/**
 * 全景事件名的**双拼写**表（issue #165 TASK 6）
 *
 * ## 为什么需要它
 *
 * 事件名是公共契约，而用户拿到事件名的来源有**两份且拼写不同**：
 *
 * | 来源 | 拼写 |
 * | --- | --- |
 * | JSAPI 声明 `panorama/PanoramaEvent.d.ts` 的 `PanoramaEventMap` 键 | snake_case（`link_click`） |
 * | 官方 React 参考 `src/components/Panorama/index.tsx` 的 `on*` props | camelCase（`onLinkClick`） |
 *
 * 用户从任一份文档抄到名字都可能写进模板，因此**两种拼写都必须能绑上**。
 *
 * 官方 React 参考暴露的 11 个 `on*`（`onClick` `onDblClick` `onLinkClick` `onLinksChange`
 * `onIdChange` `onSceneTypeChange` `onPositionChange` `onPovChange` `onZoomChange`
 * `onError` `onDataLoad`）证明 camelCase 是**官方认可的封装形状**——本库沿用它作为
 * 对外名（它早已发布，改名是破坏性变更），并把 SDK 拼写作为**一对一别名**补上。
 *
 * 这与 `core/events/eventCatalog.ts` 的 `MAP_EVENT_EMIT_ALIASES` 是**同一条口径**：
 * 「用户从不同官方文档抄到的事件名都得能用」。命名、形状、语义逐字对齐。
 *
 * ## 为什么不复用 `MAP_EVENT_EMIT_ALIASES` 本身
 *
 * 形状相同，但那张表的**内容**由 `MAP_EVENT_CATALOG` 派生，而 map 的名字规则是
 * `vue = sdk.replace(/_/g, "-")`（**kebab**）。`<Panorama>` 的对外名是 camelCase 且已发布，
 * 因此把全景事件塞进那张表要付三笔账：
 *
 * 1. 在 map 事件的单一事实源里塞进一批**不符合 kebab 规则**的条目，并让
 *    `resolveMapEventName()` 的「任一种拼写都归一」索引收下它们——那是给 map 加一个
 *    只为全景服务的例外；
 * 2. 借用 `MapEventEmits`（显式键接口）——它的载荷是 `MapEventPayload` / `MapPointerEvent`，
 *    与全景的 `Point | null` / `PanoramaLink[]` 完全不同，两套载荷混进一个接口后，
 *    `EmitPayloadMismatches` 那条类型门禁就失去意义了；
 * 3. 想让组件用上那张表就得走 `useOverlaySpec` / `OverlayKind`，而全景**不是覆盖物**
 *    （它在独立容器上，`core/panorama/index.ts` 明确不挂到 Map 上），加进去会破坏
 *    「kind 集封闭」与「矩阵驱动的绑定」两条前提。
 *
 * 所以这里是**等价物**：一张只装全景的表，组件里**没有第二份兼容代码**。
 *
 * ## 判据：什么算「别名」，什么不算
 *
 * **别名 = 同一个官方事件的两种拼写**。因此它必须是官方 `PanoramaEventMap` 里的键，
 * 且与对外名构成可推导的一对。以下三类**不是**别名，刻意不在这张表里：
 *
 * 1. **改名**：`dataload → load` / `pano_error → error`（见 `PANORAMA_EVENT_RENAMED`）。
 *    官方名与对外名不是同一个名字的两种写法，发出去会凭空多出一条官方没承诺的事件；
 * 2. **逐字相同**：`click` / `dblclick` / `touchstart` / `touchend` / `clickonroad`
 *    ——上游事件名本来就没有分隔符，camelCase 与 snake_case 对它们是同一个字符串。
 *    加「别名」等于把同一个监听回调调两遍；
 * 3. **不 1:1**：`visible` 是**prop** 而不是事件；官方 React 参考的 `onPovChange()`
 *    不带任何值（本库的 `povChange` 靠回读 `getPov()` 补值）。这类差异是**载荷口径**
 *    的差异，不是名字的差异，不进别名表。
 *
 * 双向由 `tests/behavior/panorama-event-aliases.test.ts` 钉住：别名集合 = 组件订阅的
 * 全部带 `_` 的 SDK 键，别名必须在官方 `.d.ts` 里声明。
 */

/**
 * 对外事件名 → SDK 拼写别名（`<Panorama>` 上两个名字都会发）。
 *
 * 与 `MAP_EVENT_EMIT_ALIASES` 逐字同源：`Readonly<Record<对外名, readonly string[]>>`，
 * 组件统一走「先发规范名，再按这张表发别名」。
 */
export const PANORAMA_EVENT_EMIT_ALIASES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    positionChange: Object.freeze(["position_changed"]),
    povChange: Object.freeze(["pov_changed"]),
    zoomChange: Object.freeze(["zoom_changed"]),
    idChange: Object.freeze(["id_changed"]),
    sceneTypeChange: Object.freeze(["scene_type_changed"]),
    linksChange: Object.freeze(["links_changed"]),
    linksVisibleChanged: Object.freeze(["links_visible_changed"]),
    linkClick: Object.freeze(["link_click"]),
    povChangedEnd: Object.freeze(["pov_changed_end"]),
    sceneChangeEnd: Object.freeze(["scene_change_end"]),
    sizeChanged: Object.freeze(["size_changed"]),
    overlayAdd: Object.freeze(["overlay_add"]),
    overlayRemove: Object.freeze(["overlay_remove"]),
    overlaysClear: Object.freeze(["overlays_clear"]),
    visiblePoiTypeChanged: Object.freeze(["visible_poi_type_changed"]),
  });

/** 全部对外事件名（规范名 ∪ 别名名都算在内，供门禁核对）。 */
export const PANORAMA_EVENT_NAMES: readonly string[] = Object.freeze([
  // camelCase 对外名
  ...Object.keys(PANORAMA_EVENT_EMIT_ALIASES),
  // 逐字相同的官方名（`click` / `dblclick` / `touchstart` / `touchend` / `clickonroad`）
  "click",
  "dblclick",
  "touchstart",
  "touchend",
  "clickonroad",
  // **改名**的两条（对外名与 SDK 名都不同名，因此都不是别名）
  "load",
  "error",
]);

/**
 * **改名**（不是拼写别名）的两条：对外名与官方 `PanoramaEventMap` 键不同名。
 *
 * 不给它们发 SDK 拼写别名，理由逐条：
 *
 * - `dataload → load`：官方事件名 `dataload` 与对外名 `load` 不是同一个名字的两种写法。
 *   若一并发出，监听 `@dataload` 就成了一条**官方从未承诺**的事件路径，而它带的是
 *   `{data}` 原始载荷——与 `load` 现有契约不同，等于凭空长出第二个 `load` 语义。
 * - `pano_error → error`：除上条的理由外还多一层——`error` 是本库**所有**组件通用的
 *   失败出口，`pano_error` 在场景数据失败语境下与它同名会让「哪一条失败了」变得不可读。
 *
 * 两条的载荷透传官方事件对象（`{data}`），属既有契约，本次不改。
 */
export const PANORAMA_EVENT_RENAMED: readonly {
  readonly publicName: string;
  readonly sdk: string;
  readonly reason: string;
}[] = Object.freeze([
  Object.freeze({
    publicName: "load",
    sdk: "dataload",
    reason: "改名而非拼写差异；一并发出会多出一条带原始 {data} 载荷的官方未承诺路径",
  }),
  Object.freeze({
    publicName: "error",
    sdk: "pano_error",
    reason: "改名且与本库通用的 error 出口同名；一并发出会让「哪一条失败」不可读",
  }),
]);
