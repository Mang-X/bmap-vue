/**
 * `<Marker>` / `<Label>` / `<MarkerCluster>` 补齐项的**声明面**契约（issue #165 第三批）
 *
 * 运行时行为（选项真的到达 SDK、`mutable` 真的就地调 setter、`recreate` 真的重建实例、
 * 「未给 ⇒ 键不进构造 options」）由 `tests/behavior/marker-label-cluster-options.test.ts`
 * 钉住；本文件钉的是**声明面**——官方 `@baidumap/jsapi-v4-types@4.0.5` 逐条核对之后，
 * **哪些键该被收下、哪些键必须收不下**。
 *
 * 为什么落在本目录而不是 `*.test.ts`：`tsconfig.tests.json` 只 include
 * `tests/performance` 与 `tests/browser/live-performance`，写在 `tests/behavior/` 的
 * `@ts-expect-error` **不会被任何 tsc 编译**，因此永远翻红不了（与
 * `vector-ctor-options.type-test.ts` 同款理由）。
 *
 * **判别力双向**：每条 `@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红。
 *
 * ## 为什么本文件里「反向键」的分量比正向还大
 *
 * 这一批补的是**此前本库声称过、但没兑现**的选项（`<Label>.anchor` 在描述符里
 * `mutateBy("setAnchor")` 却**没有** prop），风险因此不是「少一个」而是「多一个」：
 * 把 `<Label>.width` 补成 `mutable`、或把 `<Marker>.label` 补成 `recreate` 而实际它是
 * `mutable`（官方有 `setLabel` / `getLabel`），都会让「改 prop 就生效」这条承诺当场翻假。
 * 因此每条正向键都配一条「分类必须是这一类」的断言，正反两面一起钉。
 */
import type {
  LabelProps,
  MarkerClusterProps,
  MarkerProps,
} from "../../packages/bmap-vue/src/types/components";

const P = { lng: 116.404, lat: 39.915 };
const SIZE = { x: 8, y: -12 };

/* -------------------------------------------------------------------- <Marker> 正向
 *
 * 逐条对应官方 4.0.5 的 `overlay/MarkerOptions.d.ts`（共 16 个键）：
 * - `label`（:74）—— 实例上有 `setLabel(label: Label): void` / `getLabel(): Label`
 *   （`overlay/Marker.d.ts:110` / `:115`）⇒ **mutable**（就地换标注，不换 Marker）。
 *   ⚠️ live 读数（2026-09-27，settle 之后）：`setLabel` / `getLabel` 都在**原型链 layer 1**、
 *   真调不抛、`getLabel().getContent()` 读回改后的文案（`"hello"` → `"second"`）⇒ 可观察地生效。
 * - `autoFollowHeadingChanged`（:87）—— `Marker.d.ts` 的**成员表里没有**对应 setter
 *   （逐条核对：`setIcon` / `setPosition` / `setOffset` / `setTitle` / `setLabel` /
 *   `enable|disableDragging` / `enable|disableMassClear` / `setZIndex` / `setAnchor` /
 *   `setRotation` / `setRotationOrigin` / `setRank` / `setOptions` / `getIcon` / `getPosition` /
 *   `getOffset` / `getTitle` / `getAnchor` / `getMap` / `open|closePlaceDetail` —— 没有它）
 *   ⇒ **recreate**。
 * - `startAnimation`（:91）—— 同上，**没有** `setStartAnimation` ⇒ **recreate**。
 *
 * ⚠️ live 反证（2026-09-27，settle 之后）：`setAutoFollowHeadingChanged` 与
 * `setStartAnimation` 在**整条原型链上都不在**（layer = **-1**，实例上 `typeof` 也是
 * `undefined`）——这与 `setStrokeLineCap` 那种「在链上但调了不生效」不同，
 * 是**干净的不存在**，不需要「可观察地生效」那条更严的判据来支撑。
 */
const _marker: MarkerProps = {
  position: P,
  label: { content: "hi", position: P, offset: SIZE },
  autoFollowHeadingChanged: true,
  startAnimation: "grow",
};
void _marker;

/* -------------------------------------------------------------------- <Marker> 反向
 *
 * 官方 `MarkerOptions` 的 16 个键里**没有**的，收到就是「本库声称支持、官方没承诺」：
 * - `enableClicking` 之外没有 `enableClick`（官方拼 `enableClicking`）；
 * - `dragCursor`（官方叫 `draggingCursor`，已在 #168 收）；
 * - `opacity`（Marker 覆盖物没有不透明度，官方只在 `Label` 上声明 `setOpacity`）。
 */
const _markerNoOpacity: MarkerProps = {
  position: P,
  // @ts-expect-error MarkerOptions 没有 opacity（官方 16 个键里没有；Label 才有 setOpacity）
  opacity: 0.5,
};
const _markerNoDragCursor: MarkerProps = {
  position: P,
  // @ts-expect-error 官方键名是 draggingCursor（不是 dragCursor）
  dragCursor: "grabbing",
};
const _markerNoShadow: MarkerProps = {
  position: P,
  // @ts-expect-error MarkerOptions 没有 shadow
  shadow: true,
};
void [_markerNoOpacity, _markerNoDragCursor, _markerNoShadow];

/* --------------------------------------------------------------------- <Label> 正向
 *
 * 官方 4.0.5 的 `overlay/LabelOptions.d.ts`（共 7 个键）：
 * - `anchor`（:19）—— **此前描述符里已有**（`mutateBy("setAnchor", { ctorKey: "anchor" })`）
 *   却**没有组件 prop**：描述符说有、组件不暴露 ⇒ 更新一次都不会被触发。
 *   live 读数（2026-09-27，settle 之后）：`setAnchor` 在原型链 **layer 1**、真调不抛，
 *   **而且可观察地生效**——同一经纬度上三个 Label（默认 / `anchor: 8` / `anchor: 2`）的
 *   DOM 位置分别是 `(top 90, left 263)` / `(top 69, left 217)` / `(top 69, left 263)`，
 *   对 `anchor: 8` 的那个调 `setAnchor(0)` 之后**移回 `(top 90, left 263)`**
 *   （锚点改变 ⇒ 标注相对地理点的角点改变）⇒ `mutable` 判据成立。
 * - `width`（:29）—— `Label.d.ts` 的成员表里**没有** `setWidth`（live：整条原型链 layer = **-1**，
 *   实例上 `typeof` = `undefined`，真调一次抛 `lb.setWidth is not a function`）⇒ **recreate**。
 *   ⚠️ 构造期它**确实生效**（live：不给时 DOM `width: 14px`（按内容自适应），
 *   给 `width: 77` 时 `width: 77px`），所以这一项是「构造期可用」而不是「不可实现」。
 *
 * 锚点取值是**官方常量名**（与 `<ZoomControl>` 等控件同一口径）：`ControlAnchor` 是
 * `BMAP_ANCHOR_*` 九个常量的联合，**不是** 0–8 的裸数字。live 读数确认常量表在
 * `window` 与 `BMap` 命名空间上都成立（`BMAP_ANCHOR_BOTTOM_CENTER === 8`），
 * 因此「控件那一套 `ANCHOR_VALUES` 换算」在覆盖物上同样成立——见
 * `driver/jsapi-v4/overlays.ts` 的 `resolveAnchor`。
 */
const _label: LabelProps = {
  content: "hi",
  position: P,
  anchor: "BMAP_ANCHOR_BOTTOM_CENTER",
  width: 77,
};
void _label;

const _labelBadAnchor: LabelProps = {
  content: "hi",
  position: P,
  // @ts-expect-error anchor 是官方 ControlAnchor 常量名（九选一），不是裸数字
  anchor: 8,
};
const _labelBadAnchorName: LabelProps = {
  content: "hi",
  position: P,
  // @ts-expect-error 锚点名必须是 BMAP_ANCHOR_* 之一
  anchor: "TOP_CENTER",
};
const _labelNoHeight: LabelProps = {
  content: "hi",
  position: P,
  // @ts-expect-error LabelOptions 没有 height（只有 width，且它也没有 setHeight）
  height: 20,
};
const _labelNoOpacity: LabelProps = {
  content: "hi",
  position: P,
  // @ts-expect-error LabelProps 没有 opacity（官方 setOpacity 在描述符里，本库刻意不开面）
  opacity: 0.5,
};
void [_labelBadAnchor, _labelBadAnchorName, _labelNoHeight, _labelNoOpacity];

/* ------------------------------------------------------------ <MarkerCluster> 正向
 *
 * 官方 4.0.5 的 `visualization/ClusterLayer.d.ts` 的 `ClusterLayerOptions` 声明了六个
 * 聚合/交互参数，本库此前一个都没收（只收了 6 个同族的：clusterRadius / clusterMinPoints /
 * clusterMinZoom / clusterMaxZoom / fitViewOnClick / singleStyle）——**没有**书面理由，
 * 与它们同族的六个就在同一个 props 接口里。这是**遗漏**而不是收窄，因此补齐。
 *
 * 逐条分类**全部是 `recreate`**（构造期），依据是 live 读数（2026-09-27，真实 AK + headless
 * Chrome，见行为测试文件头的读数表）：官方 `ClusterLayer` 的成员表里**没有**这六个的
 * 任何字段级 setter。`setOptions` 虽是公开成员，但那是**整袋**入口，**不是**逐字段 setter：
 * 官方专页自己也写「聚合参数变更会重算索引」，本库不把整袋替换当成字段级 `mutable`
 * （与 `PathCtorCommonProps` 整族 `recreate` 同一口径：没有**公开的逐字段入口**就是构造期）。
 */
interface Item {
  id: string;
  lng: number;
  lat: number;
}
const _cluster: MarkerClusterProps<Item> = {
  data: [],
  itemKey: "id",
  getPosition: (item) => ({ lng: item.lng, lat: item.lat }),
  clusterRadius: 60,
  tileSize: 512,
  fitViewMargin: [12, 12, 12, 12],
  updateRealTime: true,
  waitTime: 300,
  clusterIcon: () => "https://example.invalid/cluster.png",
  clusterIconSize: () => [40, 41],
};
void _cluster;

/* ------------------------------------------------------------ <MarkerCluster> 反向
 *
 * `ClusterLayerOptions` **没有**的键，收下就是假支持：
 * - `minZoom` / `maxZoom`：官方确实声明了它们，但官方**没有** `setZoomRange` /
 *   `setMinZoom` / `setMaxZoom`（live：整条原型链 layer = **-1**）⇒ 收下就是
 *   「改 prop 悄悄不生效」。这是本票「不加」的第一类。
 * - `enablePicked` / `mouseStyleChange` / `pickTolerance`：前两个本库**刻意**硬编码 /
 *   不暴露（见 `nativeClusterEngine.ts` 的拾取决策与任务说明），第三个官方没在本库登记面里。
 * - `data` / `idKey`：由 `data` / `itemKey` 表达（`DataComponentProps`），
 *   官方那两个键**不是**额外的组件面。
 */
const _clusterNoZoom: MarkerClusterProps<Item> = {
  data: [],
  // @ts-expect-error ClusterLayerOptions 虽有 minZoom，但官方没有 setZoomRange/setMinZoom
  //（整条原型链 layer = -1）⇒ 收下就是「改 prop 悄悄不生效」
  minZoom: 3,
};
const _clusterNoMaxZoom: MarkerClusterProps<Item> = {
  data: [],
  // @ts-expect-error 同 minZoom：maxZoom 也没有字段级入口
  maxZoom: 21,
};
const _clusterNoPickTolerance: MarkerClusterProps<Item> = {
  data: [],
  // @ts-expect-error 本库不暴露 pickTolerance（拾取面整体是 native 引擎的内部决策）
  pickTolerance: 4,
};
void [_clusterNoZoom, _clusterNoMaxZoom, _clusterNoPickTolerance];
