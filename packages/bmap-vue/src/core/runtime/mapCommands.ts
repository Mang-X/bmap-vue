/**
 * MapCommands —— 面向使用者的**精简地图命令面**（M4-HANDLE-UX / issue #29）
 *
 * ## 为什么不是「把 `BMap.Map` 的方法都透传」
 *
 * issue #29 的非目标第一条就是「不把完整 `BMap.Map` 方法全部透传」，理由是**冻结 SDK 表面**：
 * 透传越多，公共 API 越难演进，而本库的能力清单（Capability Catalog）才是「哪些能力可用」的
 * 单一事实源。官方参考实现 `huiyan-fe/react-bmap@2.0.1` 的 `MapRefImpl` 走了另一个方向
 * （`src/components/Map/MapRef.ts` 逐个透传 200+ 个成员，含 `getSolarInfo` / `getTileId` /
 * 室内与地球模式）—— 那是「JSAPI 方法表的镜像」，不是本库的选择。
 *
 * 因此这里只冻结 **get / set / pan / fit / supports** 五类常用命令，其余能力有两条路：
 * - 「我就要那个能力」→ 先 `supports(capability)` 问（不猜），再按能力名去找对应的 Facet/组件；
 * - 「我要 raw SDK 对象」→ `getMapInstance()` 拿句柄，再用 `./advanced` 的 `unwrapRaw()`。
 *
 * ## 未就绪时是空操作，不是排队
 *
 * 读命令在「没有句柄 / 读不出来」时返回 `null`（沿用 `readLiveView` 的口径：只有
 * 「资源已销毁」「当前引擎没有该能力」算读不到，其余错误照常上抛）；写命令在没有句柄时**什么都不做**。
 * 刻意**不做**「先排队、就绪后重放」：那会让命令的生效时机变得不可观察，而调用方本来就有
 * `await whenReady()` 这条确定性路径。这条选择的代价写在 ADR
 * `2026-09-14-map-handle-container-and-visibility` 的「已知限制」里。
 *
 * `checkResize` **不在这里**：它必须与「容器门禁 + 暂停策略」同一口径（暂停期间不得下发 SDK
 * 命令），因此归 `<Map>` 的 expose，由 `MapRuntime` 统一实现 —— 命令面自己再实现一份
 * 就会与暂停策略漂移。
 */
import type { BMapClient } from "../../client/types";
import type { Capability } from "../../driver/capability";
import type { Bounds, Pixel, Point, Size } from "../../driver/types/geometry";
import type { MapHandle } from "../../driver/types/handles";
import type { FlyToOptions, Viewport } from "../../driver/types/map";
import type { ViewportOptions } from "../../driver/types/services";
import { readLiveView } from "../utils/liveView";

/**
 * 精简地图命令面。
 *
 * 所有**读**命令在没有可用句柄时返回 `null`（`supports` 返回 `false`），所有**写**命令在同样
 * 情况下是空操作；SDK 调用失败（`BMapError`）一律照常抛出，不降级成 `null`。
 */
export interface MapCommands {
  /* ---------------------------------------------------------------- 读（返回 null = 读不到） */
  getCenter(): Point | null;
  getZoom(): number | null;
  getHeading(): number | null;
  getTilt(): number | null;
  getBounds(): Bounds | null;
  getSize(): Size | null;
  /**
   * 读出「若把这些点/范围装进视野，应该是什么中心与级别」（只读，不改当前视野）。
   *
   * `view` 对齐官方的两个分支：点数组或 `Bounds`。返回 `null` = 这次读不到
   * （没句柄 / 资源已销毁 / 该能力在本引擎不可用），口径与本面其余读命令一致。
   */
  getViewport(view: readonly Point[] | Bounds, options?: ViewportOptions): Viewport | null;
  /**
   * 取当前画布截图（数据 URL 字符串）。
   *
   * ⚠️ 官方的两条限制本库不隐瞒：**地球模式不支持**；建图时**必须**带
   * `preserveDrawingBuffer: true`，否则拿到的是**空画布**（官方称「黑屏」）。
   *
   * **要拿到真实画面，必须在建图时开启**：`<Map :preserve-drawing-buffer="true">`
   * （该 prop 默认**不开启**——常驻一块画布内存是库不该替使用者做的取舍，官方 React 参考
   * 的惯例同样是「能力进目录 + 显式 opt-in」）。它是**建图期**选项，事后补不上。
   * 2026-09-26 live 实测：同一张图不带该选项返回 3,830 字节空画布、带上则 119,074 字节
   * 真实内容（读数见 `docs/zh-CN/contributing/165-runtime-verification.md`）。
   */
  getScreenshot(): string | null;

  /* ---------------------------------------------------------------- 写（未就绪时空操作） */
  /**
   * 设置中心点。`center` 对齐官方 `setCenter(center: Point | string, options?)` 的**两个分支**：
   * 点，或城市名 / 地址字符串。
   *
   * #165 Class 2 / E：此前这一层写的是 `Point`，于是同一个组件上出现了**两张脸**——
   * `<Map center>` prop 收字符串（v2 兼容），命令面却不收；而底下的
   * `MapDriver.setCenter(map, Point | string)` 与 `toRawCenter` **本来就**处理字符串。
   * 收窄只发生在最上面这一层，官方能力因此不可达。命令面与 prop 现在对齐。
   *
   * ⚠️ 字符串中心的**已知限制**（与 prop 侧同一条，不是新引入的）：字符串**无法**与受控
   * 状态做等值比较（官方 React 参考 `Map.tsx:24-26` 据此在 prop 上直接拒收 string）。
   * 本库在 prop 侧为 v2 兼容保留它，因此「受控 `center` 用字符串」只能当初值用——
   * 用户交互后 `update:center` 回写的是具体坐标。命令面是「一次性跳转」，没有这个问题。
   *
   * live 实测（2026-09-27 真实 AK）：`setCenter('北京')` 会真的移动到北京；官方对**无法识别**
   * 的地名也不抛错，而是回落到某处（实测 `'NotACityName-zzz'` 同样移动、不抛），
   * 因此「字符串没生效」不能从「没报错」推断。
   */
  setCenter(center: Point | string): void;
  setZoom(zoom: number): void;
  setHeading(heading: number): void;
  setTilt(tilt: number): void;

  /* ---------------------------------------------------------------- 平移 / 适配 */
  panTo(point: Point): void;
  panBy(pixel: Pixel): void;
  fitBounds(bounds: Bounds): void;
  /**
   * 平滑**飞行**到目标中心与级别（官方 `Map#flyTo`）。
   *
   * 与 `panTo`（瞬移）是**两个不同的成员**：`flyTo` 带一段飞行动画，适合「从全国飞到某地」
   * 这类定位；`panTo` 只挪动中心点、不动级别。
   */
  flyTo(center: Point, zoom: number, options?: FlyToOptions): void;

  /* ---------------------------------------------------------------- 能力查询 */
  /**
   * 当前引擎在这个版本上是否支持某能力。
   *
   * 走的是 Client 的 Capability Registry（能力清单的单一事实源），因此 `unsupported` 的能力
   * 会如实返回 `false`，而不是「调用之后才知道」。**没有 Client 时返回 `false`**：
   * 「还不知道」与「不支持」在这里合并成同一个答案（`false`），因为调用方要的是「能不能用」。
   *
   * **两条边界要知道**（#29 评审 P1 之后写死在这里）：
   *
   * 1. 探测来源是「命名空间顶层 + `Map.prototype` + **运行时观察到的实例成员**」。第三项来自
   *    Map Facet 建图成功后的登记 —— 真实 JSAPI 4.0 有一部分 Map 方法（`setZoom` / `setCenter`）
   *    挂在实例上而不是原型上，少了它 `supports("map.zoom")` 会假阴性；
   * 2. 因此**建图之前**，Map 作用域的能力（`map.zoom` 这类 `runtimeOnly` 的）可能仍是 `false`
   *    —— 那时也确实没有可操作的对象。需要确定性时先 `await whenReady()` 再问。
   */
  supports(capability: Capability): boolean;
}

/**
 * 命令面的数据来源。
 *
 * 刻意用**取值函数**而不是 ref：命令面既服务 `<Map>` 自己的 expose（数据来自
 * `MapRuntime` 的 shallow refs），也服务未来任何持有句柄的场景，取值函数是两者唯一的公共形状。
 */
export interface MapCommandSource {
  client(): BMapClient | null;
  map(): MapHandle | null;
}

/** 句柄与 Client 同时可用时的快照（缺一时命令面走各自的空路径）。 */
function resolveTarget(source: MapCommandSource): { client: BMapClient; map: MapHandle } | null {
  const client = source.client();
  const map = source.map();
  if (!client || !map) return null;
  return { client, map };
}

export function createMapCommands(source: MapCommandSource): MapCommands {
  /** 读：只把「资源已销毁 / 该能力不可用」当作读不到，其余错误上抛。 */
  function read<T>(read: (client: BMapClient, map: MapHandle) => T): T | null {
    const target = resolveTarget(source);
    if (!target) return null;
    return readLiveView(() => read(target.client, target.map));
  }

  /** 写：没有句柄时空操作；有句柄时让 SDK 错误如实传播。 */
  function write(write: (client: BMapClient, map: MapHandle) => void): void {
    const target = resolveTarget(source);
    if (!target) return;
    write(target.client, target.map);
  }

  return {
    getCenter: () => read((client, map) => client.driver.map.getCenter(map)),
    getZoom: () => read((client, map) => client.driver.map.getZoom(map)),
    getHeading: () => read((client, map) => client.driver.map.getHeading(map)),
    getTilt: () => read((client, map) => client.driver.map.getTilt(map)),
    getBounds: () => read((client, map) => client.driver.map.getBounds(map)),
    getSize: () => read((client, map) => client.driver.map.getSize(map)),
    getViewport: (view, options) =>
      read((client, map) => client.driver.map.getViewport(map, view, options)),
    getScreenshot: () => read((client, map) => client.driver.map.getScreenshot(map)),

    setCenter: (center) => write((client, map) => client.driver.map.setCenter(map, center)),
    setZoom: (zoom) => write((client, map) => client.driver.map.setZoom(map, zoom)),
    setHeading: (heading) => write((client, map) => client.driver.map.setHeading(map, heading)),
    setTilt: (tilt) => write((client, map) => client.driver.map.setTilt(map, tilt)),

    panTo: (point) => write((client, map) => client.driver.map.panTo(map, point)),
    panBy: (pixel) => write((client, map) => client.driver.map.panBy(map, pixel)),
    fitBounds: (bounds) => write((client, map) => client.driver.map.fitBounds(map, bounds)),
    flyTo: (center, zoom, options) =>
      write((client, map) => client.driver.map.flyTo(map, center, zoom, options)),

    supports: (capability) => source.client()?.capabilities.supports(capability) ?? false,
  };
}
