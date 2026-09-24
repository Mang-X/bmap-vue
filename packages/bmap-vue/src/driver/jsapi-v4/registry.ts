/**
 * Handle Registry（M3A2-01 / issue #19）
 *
 * 官方 raw 对象（Map / Overlay / Layer / Service 实例）在离开 Driver 边界后一律以
 * 项目 `SdkHandle` 存在。Registry 负责三件事：
 *
 * 1. **双向映射**：`adopt` 建立 raw → Handle（WeakMap，随 raw 一起被 GC），
 *    `resolve` 走 Handle → raw；
 * 2. **稳定 identity**：同一个 registry 上同一 raw 对象每次 `adopt` 都返回同一个
 *    Handle 实例——组件比对句柄、`Map` 身份缓存都依赖这一点；
 * 3. **所有权可验证**：每个 registry 持有一枚私有 `owner` 令牌，Handle 的品牌对象上
 *    不暴露它（公共 `SdkHandle` 形状保持不变，所有权只存在内部 WeakMap 中），
 *    因此**跨 Client 混用句柄会被拒绝**，而不是悄悄操作另一个地图的资源。
 *
 * 「不让跨 Client 混用」是硬约束：把 A 地图的 Marker 句柄传给 B 地图的 Driver 属于
 * 典型的所有权错误，必须在边界立刻失败（`BMAP_HANDLE_FOREIGN`），而不是等 SDK 侧
 * 出现难以定位的异常。同一 raw 对象在两个 Client 上各自登记时互不可见——两个 registry
 * 的 WeakMap 与令牌都是独立的。
 */
import { BMapError } from "../../core/errors/BMapError";
import { HANDLE_BRAND, createHandle, type SdkHandle } from "../types/handles";
import { isObjectLike } from "./internal";

export interface JsapiV4HandleRegistry {
  /** raw → Handle：同一 raw 返回稳定 Handle；kind 冲突或 raw 不可作键时失败。 */
  adopt<Kind extends string, Raw>(kind: Kind, raw: Raw): SdkHandle<Kind, Raw>;

  /** raw → Handle 的反查；未登记（或不是对象）返回 `undefined`，不抛错。 */
  lookup(raw: unknown): SdkHandle<string> | undefined;

  /** Handle → raw；句柄不属于本 registry 时抛 `BMAP_HANDLE_FOREIGN`。 */
  resolve<Raw = unknown>(handle: SdkHandle<string>): Raw;

  /** 句柄所有权校验（不抛错的谓词形式）。 */
  owns(handle: unknown): handle is SdkHandle<string>;
}

export function createJsapiV4HandleRegistry(): JsapiV4HandleRegistry {
  const owner = Symbol("jsapi-v4-handle-owner");
  // 映射必须**每个 registry 一份**：共享模块级映射会让两个 Client 的句柄互相可见，
  // 「跨 Client 混用被拒绝」这条硬约束就失效了。
  const rawToHandle = new WeakMap<object, SdkHandle<string>>();
  const handleOwners = new WeakMap<object, symbol>();

  const assertOwned = (handle: SdkHandle<string>): void => {
    if (!isObjectLike(handle) || handleOwners.get(handle) !== owner) {
      throw new BMapError(
        "BMAP_HANDLE_FOREIGN",
        "Handle 不属于当前 Client：句柄只能在创建它的 Client/Driver 上使用（跨 Client 混用会操作到另一张地图的资源）",
        { engine: "jsapi-v4" },
      );
    }
  };

  return {
    adopt<Kind extends string, Raw>(kind: Kind, raw: Raw): SdkHandle<Kind, Raw> {
      if (!isObjectLike(raw)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `Handle Registry 只接受对象型 raw（kind: ${kind}，收到 ${typeof raw}）`,
          { engine: "jsapi-v4" },
        );
      }

      const existing = rawToHandle.get(raw);
      if (existing) {
        if (existing[HANDLE_BRAND] !== kind) {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            `同一 raw 对象已登记为 "${existing[HANDLE_BRAND]}"，不能再登记为 "${kind}"（Handle 类型必须稳定）`,
            { engine: "jsapi-v4" },
          );
        }
        return existing as SdkHandle<Kind, Raw>;
      }

      const handle = createHandle(kind, raw);
      rawToHandle.set(raw, handle);
      handleOwners.set(handle, owner);
      return handle as SdkHandle<Kind, Raw>;
    },

    lookup(raw: unknown): SdkHandle<string> | undefined {
      return isObjectLike(raw) ? rawToHandle.get(raw) : undefined;
    },

    resolve<Raw = unknown>(handle: SdkHandle<string>): Raw {
      assertOwned(handle);
      return handle.raw as Raw;
    },

    owns(handle: unknown): handle is SdkHandle<string> {
      return isObjectLike(handle) && handleOwners.get(handle) === owner;
    },
  };
}
