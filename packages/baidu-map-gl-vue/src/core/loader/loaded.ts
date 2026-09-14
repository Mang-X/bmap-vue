/**
 * SDK 加载结果（结构化契约）
 *
 * M3A1-CLIENT（issue #18）：Client 不再接收裸 SDK `unknown` 作为公共加载结果。
 * Provider 必须返回**结构化**的加载结果：`engine` 判别字段 + `namespace` + load metadata。
 *
 * M3A3-REMOVE-LEGACY（issue #26）：旧引擎（`webgl-v1`）删除后，判别联合只剩一个成员，
 * 因此 `LoadedSdk` 现在是 `LoadedJsapiV4` 的**别名**——名字保留是为了让 Provider / Client /
 * Driver 工厂的公共签名不必跟着改，而「不接受裸全局对象」这条收口仍然落在
 * `assertLoadedSdk` 上（两个失败形态：缺 `engine`、声明了 engine 但没有 `namespace`）。
 *
 * `namespace` 是 raw SDK 逃生口，只允许 Driver / Client 边界读取，组件与 Composable 不得直接访问。
 */
import { BMapError } from "../errors/BMapError";
import type { LoadedJsapiV4 } from "./providers/types";

export type { LoadedJsapiV4 };

/** 唯一的加载结果：JSAPI 4.0。 */
export type LoadedSdk = LoadedJsapiV4;

/** Provider 必须自述的 engine 判别值。 */
const JSAPI_V4_ENGINE = "jsapi-v4";

function readEngine(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const engine = (value as { engine?: unknown }).engine;
  return typeof engine === "string" ? engine : undefined;
}

/**
 * 结构化加载结果的判别：`engine` 与 `namespace` 齐备。
 *
 * 残缺结果（有 engine、无 namespace）必须被判为**不是**合法加载结果，否则它会一路走到
 * Driver 装配才炸，错误码与失败点都会退化成「第一个碰巧用到 namespace 的 Facet 决定报错」。
 */
export function isLoadedSdk(value: unknown): value is LoadedSdk {
  return readEngine(value) === JSAPI_V4_ENGINE && "namespace" in (value as object);
}

/**
 * 客户端收口：加载结果必须是结构化的 `LoadedSdk`（JSAPI 4.0）。
 *
 * 裸 `unknown`（v2 / v3-beta 的 `{ load }` 返回裸全局对象）与缺 `engine` 判别字段都会在这里
 * 失败——这正是「Client 不再接收裸 SDK unknown」的判定点。旧引擎时代的宽松归一入口
 * （`withMigrationDriver` / `createLegacyBMapClient`）已随 webgl-v1 一并删除。
 */
export function assertLoadedSdk(value: unknown): LoadedSdk {
  const engine = readEngine(value);
  if (engine === undefined) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      "Provider 必须返回结构化的 LoadedSdk（engine + namespace），不接受裸 SDK unknown",
    );
  }
  if (engine !== JSAPI_V4_ENGINE) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      `只接受 engine=${JSAPI_V4_ENGINE} 的加载结果，收到 engine=${String(engine)}；` +
        "旧引擎（webgl-v1 / BMapGL）已在 3.0 删除，请改用 v4 Provider 家族",
      { engine },
    );
  }
  if (!("namespace" in (value as object))) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      `加载结果声明了 engine=${engine} 但缺少 namespace（raw SDK 逃生口）`,
      { engine },
    );
  }
  return value as LoadedSdk;
}
