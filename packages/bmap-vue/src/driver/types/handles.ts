/**
 * SdkHandle
 *
 * 所有 SDK 对象(地图、覆盖物、控件、图层、服务)在离开 Driver 边界后
 * 都以 Handle 存在。Handle 携带内部 symbol 标明种类，只允许在 Driver
 * 内部创建；业务组件与业务 composable 不直接创建 Handle，如需 raw SDK
 * 对象必须走 `./advanced` 的 `unwrapRaw()` 逃生口。
 */

export const HANDLE_BRAND: unique symbol = Symbol("bmap-vue.handle");

export interface SdkHandle<Kind extends string, Raw = unknown> {
  readonly [HANDLE_BRAND]: Kind;
  readonly raw: Raw;
}

export type MapHandle = SdkHandle<"map">;
export type OverlayHandle = SdkHandle<"overlay" | `overlay:${string}`>;
export type MarkerHandle = SdkHandle<"overlay:marker">;
export type InfoWindowHandle = SdkHandle<"overlay:info-window">;
export type PolylineHandle = SdkHandle<"overlay:polyline">;
export type PolygonHandle = SdkHandle<"overlay:polygon">;
export type CircleHandle = SdkHandle<"overlay:circle">;
export type LabelHandle = SdkHandle<"overlay:label">;
/**
 * Control 句柄：品牌带种类（`control:<kind>`），与 Overlay / Layer 句柄同形。
 *
 * 裸 `"control"` 仍然合法（webgl-v1 与手工登记的句柄用），此时 `setOptions` 只能走
 * 结构调用的通用路径，拿不到种类专属的更新口径。
 */
export type ControlHandle = SdkHandle<"control" | `control:${string}`>;
export type LayerHandle = SdkHandle<"layer" | `layer:${string}`>;
export type ServiceHandle<Kind extends string = "service"> = SdkHandle<Kind>;

/** 仅 Driver 内部使用：创建 Handle */
export function createHandle<Kind extends string, Raw>(
  kind: Kind,
  raw: Raw,
): SdkHandle<Kind, Raw> {
  return Object.freeze({ [HANDLE_BRAND]: kind, raw }) as SdkHandle<Kind, Raw>;
}

/** `./advanced` 逃生口：取出 raw SDK 对象 */
export function unwrapRaw<T = unknown>(handle: SdkHandle<string>): T {
  return handle.raw as T;
}
