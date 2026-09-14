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
 * 命令），因此归 `<BMap>` 的 expose，由 `MapRuntime` 统一实现 —— 命令面自己再实现一份
 * 就会与暂停策略漂移。
 */
import type { BMapClient } from "../../client/types";
import type { Capability } from "../../driver/capability";
import type { Bounds, Pixel, Point, Size } from "../../driver/types/geometry";
import type { MapHandle } from "../../driver/types/handles";
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

  /* ---------------------------------------------------------------- 写（未就绪时空操作） */
  setCenter(center: Point): void;
  setZoom(zoom: number): void;
  setHeading(heading: number): void;
  setTilt(tilt: number): void;

  /* ---------------------------------------------------------------- 平移 / 适配 */
  panTo(point: Point): void;
  panBy(pixel: Pixel): void;
  fitBounds(bounds: Bounds): void;

  /* ---------------------------------------------------------------- 能力查询 */
  /**
   * 当前引擎在这个版本上是否支持某能力。
   *
   * 走的是 Client 的 Capability Registry（能力清单的单一事实源），因此 `unsupported` 的能力
   * 会如实返回 `false`，而不是「调用之后才知道」。**没有 Client 时返回 `false`**：
   * 「还不知道」与「不支持」在这里合并成同一个答案（`false`），因为调用方要的是「能不能用」。
   */
  supports(capability: Capability): boolean;
}

/**
 * 命令面的数据来源。
 *
 * 刻意用**取值函数**而不是 ref：命令面既服务 `<BMap>` 自己的 expose（数据来自
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

    setCenter: (center) => write((client, map) => client.driver.map.setCenter(map, center)),
    setZoom: (zoom) => write((client, map) => client.driver.map.setZoom(map, zoom)),
    setHeading: (heading) => write((client, map) => client.driver.map.setHeading(map, heading)),
    setTilt: (tilt) => write((client, map) => client.driver.map.setTilt(map, tilt)),

    panTo: (point) => write((client, map) => client.driver.map.panTo(map, point)),
    panBy: (pixel) => write((client, map) => client.driver.map.panBy(map, pixel)),
    fitBounds: (bounds) => write((client, map) => client.driver.map.fitBounds(map, bounds)),

    supports: (capability) => source.client()?.capabilities.supports(capability) ?? false,
  };
}
