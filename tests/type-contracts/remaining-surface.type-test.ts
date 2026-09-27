/**
 * #168 补的公共类型的**类型面**契约（issue #168 item 1 / 2 / 3）
 *
 * 运行时行为由 `tests/behavior/{control-commands,remaining-overlay-options,panorama-events}.test.ts`
 * 钉住；本文件钉的是**声明面**——「这个 prop / 命令 / 事件的类型对不对」。
 *
 * 为什么落在本目录：`tsconfig.tests.json` 只 include `tests/performance` 与
 * `tests/browser/live-performance`，写在 `tests/behavior/` 的 `@ts-expect-error`
 * **不会被任何 tsc 编译**，因此永远翻红不了（见 `overlay-zindex.type-test.ts` 的同款说明）。
 *
 * **判别力双向**：每条 `@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红。
 */
import type {
  CityListCommandApi,
  LocationAddressComponents,
  LocationCommandApi,
} from "../../packages/bmap-vue/src/driver/types/controls";
import type { ControlCommandTypes } from "../../packages/bmap-vue/src/core/controls/controlCommands";
import type { GroundOverlayProps, MarkerProps } from "../../packages/bmap-vue/src/types/components";
import type {
  PanoramaInteractionEvent,
  PanoramaLinkClickEvent,
} from "../../packages/bmap-vue/src/components/panorama/Panorama.vue";

/* ---------------------------------------------------- item 1：控件命令面 */

const _location: LocationCommandApi = {
  location: () => {},
  startLocation: () => {},
  stopLocationTrace: () => {},
  getAddressComponent: () => null,
};

// 读回：五个成员全可选，且**不补默认值**（`city ?? ""` 会把「没给」与「空」混起来）
const _address: LocationAddressComponents = {};
const _address2: LocationAddressComponents = { city: "北京市", province: "北京市" };
// @ts-expect-error 官方五个成员全是 string；给数字是类型错误
const _address3: LocationAddressComponents = { district: 123 };

// 未知成员不得被当成合法字段（收窄投影的负向判别）
// @ts-expect-error 官方 AddressComponent 没有 `location`
const _address4: LocationAddressComponents = { location: "x" };

const _cityList: CityListCommandApi = {
  toggle: () => {},
  getCityName: () => "北京市",
};

// ⚠️ `getTriggerDom` **刻意不在**命令面上：官方返回 raw `HTMLElement`，
// 控件组件是 raw SDK 禁区，收窄投影不成立（依据见 `driver/types/controls.ts`）。
// 判据用 `keyof` 而不是索引访问：索引访问一个不存在的键会直接报 TS2339（而不是被
// `@ts-expect-error` 接住），而这里要断言的正是「这个键**不在**键集里」。
// @ts-expect-error CityListCommandApi 不暴露 getTriggerDom
const _noDom: keyof CityListCommandApi = "getTriggerDom";

/** 组件名索引（`ControlCommandTypes`）：键是组件名，不是 kind。 */
const _byComponent: ControlCommandTypes["LocationControl"] = _location;
const _byComponent2: ControlCommandTypes["CityListControl"] = _cityList;
// @ts-expect-error 表里没有 OverviewMapControl（它没有命令面）
const _missing: keyof ControlCommandTypes = "OverviewMapControl";

/* ------------------------------------------ item 2：Marker 的四个构造选项 */

const _marker: MarkerProps = {
  position: { lng: 116.4, lat: 39.9 },
  raiseOnDrag: true,
  isTop: true,
  restrictDraggingArea: false,
  // ⚠️ `draggingCursor` 官方是**普通 `string`**（CSS cursor 规范），不是枚举联合。
  // 任何合法 CSS cursor 值都必须被接受——自造联合一定会漏。
  draggingCursor: "grabbing",
};
const _markerCursor: MarkerProps = {
  position: { lng: 116.4, lat: 39.9 },
  draggingCursor: "url(/c.cur), crosshair",
};

// @ts-expect-error 官方 `isTop` 是 boolean，不是字符串
const _markerBad: MarkerProps = { position: { lng: 0, lat: 0 }, isTop: "yes" };

// @ts-expect-error 官方没有 `enableRotating`（自造 prop 必须编译失败）
const _markerBad2: MarkerProps = { position: { lng: 0, lat: 0 }, enableRotating: true };

/* ------------------------------------------- item 2：GroundOverlay 的三个选项 */

const _ground: GroundOverlayProps = {
  bounds: { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } },
  // `type` 是**必填**（既有契约）：它是 `url` 语义的一部分（image / video / canvas 三选一），
  // 且 `drawHook` / `isReDraw` 只在 `type: "canvas"` 下才有意义 ⇒ 不给默认值。
  type: "image",
  url: "https://example.com/a.png",
  enableMassClear: false,
  enableClicking: false,
  top: true,
};

// ⚠️ `@ts-expect-error` 必须贴在**报错的行**上（对象字面量的属性行），
// 不是声明行——对象字面量的类型错误落在具体属性上，贴错位置会变成 TS2578（unused）。
const _groundBad: GroundOverlayProps = {
  bounds: _ground.bounds,
  type: _ground.type,
  url: _ground.url,
  // @ts-expect-error 官方 `top` 是 boolean
  top: "true",
};

const _groundBad2: GroundOverlayProps = {
  bounds: _ground.bounds,
  type: _ground.type,
  url: _ground.url,
  // @ts-expect-error `imageURL` 在官方标注 @deprecated；1.0 只提供 `url`
  imageURL: "https://example.com/a.png",
};

/* ------------------------------------------------------ item 3：Panorama 载荷 */

const _interaction: PanoramaInteractionEvent = { type: "click" };
// @ts-expect-error 载荷只投影 `type`；不得让 raw MouseEvent 的成员进来
const _interactionBad: PanoramaInteractionEvent = { type: "click", clientX: 1 };

const _linkClick: PanoramaLinkClickEvent = {};
const _linkClick2: PanoramaLinkClickEvent = { id: "pano-9" };
// @ts-expect-error 官方 `link_click` 的 id 是 string
const _linkClickBad: PanoramaLinkClickEvent = { id: 9 };

export {};
