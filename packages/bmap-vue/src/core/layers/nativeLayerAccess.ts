/**
 * 原生数据图层面的**收窄入口**（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * `nativeLayers` 是 JSAPI 4.0 Driver **独有**的 Facet（`JsapiV4Driver`），不在共享契约
 * `BMapDriver` 上——这是刻意的：#26 的 ADR 把「共享契约不动」写成硬约束，v4 专有面收在子类型里。
 * 于是消费方不能写 `context.client.driver.nativeLayers`（类型层就没有这个成员），也不能
 * 无条件 `as JsapiV4Driver`（那会把「当前引擎有没有这个面」变成一句无法验证的断言）。
 *
 * 这里与 `core/services/invocation.ts` 的 `jsapiV4ServicesOf()` **同一条口径**：
 * 运行时检查「这个面真的在」，不在就抛 `BMAP_CAPABILITY_UNSUPPORTED` 并点名 engine；
 * 检查通过后才交出收窄后的类型。
 *
 * 为什么要收窄而不是让组件自己 `as`：`#35` 会补齐其余原生图层组件（PointIcon / Cluster / …），
 * 每个组件各写一次 `as` 意味着「谁能拿到这个面」有 N 份判断；收在一处之后，将来引擎面变化
 * 只需要改这一个文件（与 `jsapiV4ServicesOf` 的存在理由完全相同）。
 */
import { BMapError } from "../errors/BMapError";
import type { BMapClient } from "../../client/types";
import type { JsapiV4Driver } from "../../driver/types/bmap";
import type { NativeLayerDriver } from "../../driver/types/native-layers";

export function nativeLayersOf(client: BMapClient): NativeLayerDriver {
  // `nativeLayers` 在共享契约 `BMapDriver` 上**不存在**（它是 v4 子类型的成员），所以先收窄 driver 本身。
  const candidate = client.driver as Partial<JsapiV4Driver>;
  const nativeLayers = candidate.nativeLayers as Partial<NativeLayerDriver> | undefined;
  if (!nativeLayers || typeof nativeLayers.create !== "function") {
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `当前 engine(${client.engine}) 的 Driver 没有原生数据图层面：` +
        "原生批量图层（PointShapeLayer / PointIconLayer / LineLayer / FillLayer …）由 JSAPI 4.0 Driver 提供",
      { engine: client.engine },
    );
  }
  return nativeLayers as NativeLayerDriver;
}
