/**
 * SDK 加载结果（结构化契约）
 *
 * M3A1-CLIENT（issue #18）：Client 不再接收裸 SDK `unknown` 作为公共加载结果。
 * Provider 必须返回**结构化**的加载结果：`engine` 判别字段 + `version` + `namespace` + load metadata。
 *
 * M3A3-REMOVE-LEGACY（issue #26）：旧引擎（`webgl-v1`）删除后，判别联合只剩一个成员，
 * 因此 `LoadedSdk` 现在是 `LoadedJsapiV4` 的**别名**——名字保留是为了让 Provider / Client /
 * Driver 工厂的公共签名不必跟着改。
 *
 * ## `assertLoadedSdk` 是**运行时**边界，校验口径必须等于公开契约
 *
 * JS 消费者、`any`、第三方 Provider 都能绕过静态类型，所以这里不能「够用就行」：
 * `version` / `namespace` / `load` metadata 缺任何一项都当场失败。否则
 * `{ engine: "jsapi-v4", namespace }` 这种半成品会被收窄成完整 `LoadedSdk`，`createBMapClient()`
 * 读到 `version: undefined` 并透传给 Driver，最终 `client.sdkVersion` 也是
 * `undefined`——一个「类型上不可能、运行期照样发生」的坏状态。
 *
 * 校验只覆盖「字段在不在、类型对不对」：`engine` / `providerId` / `mode` / `versionSource` 的
 * **取值域**由类型与各 Provider 保证，运行时再枚举一遍只会把 Provider 的值域复制成第二份事实源。
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

/**
 * `load` metadata 的必填**字符串**字段，与 `JsapiV4LoadMetadata` 一一对应
 * （另一项 `loadedAt` 是数字，单独判）。
 */
const LOAD_METADATA_STRING_FIELDS = [
  "providerId",
  "domain",
  "mode",
  "versionSource",
  "apiUrl",
  "akRef",
  "fingerprint",
] as const;

function readEngine(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const engine = (value as { engine?: unknown }).engine;
  return typeof engine === "string" ? engine : undefined;
}

/** 逐项找出「不满足 `LoadedJsapiV4` 契约」的地方；返回空数组表示完整。 */
function describeContractGaps(value: unknown): string[] {
  const gaps: string[] = [];
  const loaded = value as { version?: unknown; namespace?: unknown; load?: unknown };

  if (typeof loaded.version !== "string" || loaded.version.length === 0) {
    gaps.push("version（非空字符串）");
  }
  if (loaded.namespace === undefined || loaded.namespace === null) {
    gaps.push("namespace（raw SDK 逃生口）");
  }

  const load = loaded.load;
  if (load === null || typeof load !== "object") {
    gaps.push("load（JsapiV4LoadMetadata 对象）");
    return gaps;
  }
  const metadata = load as Record<string, unknown>;
  const missing: string[] = LOAD_METADATA_STRING_FIELDS.filter(
    (field) => typeof metadata[field] !== "string",
  );
  if (typeof metadata.loadedAt !== "number") missing.push("loadedAt");
  if (missing.length > 0) {
    gaps.push(`load.${missing.join(" / load.")}（缺失或类型不对）`);
  }
  return gaps;
}

/**
 * 结构化加载结果是否**完整**（`engine` 判别字段 + 契约要求的全部字段）。
 *
 * 残缺结果（有 engine、少 version / namespace / load）必须被判为**不是**合法加载结果：否则它会
 * 一路走到 Driver 装配才炸，错误码与失败点都会退化成「第一个碰巧用到该字段的地方决定报错」。
 */
export function isLoadedSdk(value: unknown): value is LoadedSdk {
  return readEngine(value) === JSAPI_V4_ENGINE && describeContractGaps(value).length === 0;
}

/**
 * 客户端收口：加载结果必须是完整的 `LoadedSdk`（JSAPI 4.0）。
 *
 * 三种失败形态各自有明确文案：裸 `unknown`（无 engine 判别字段）、旧引擎 `engine`、
 * 以及「声明了 engine 但不满足契约」（逐字段点名）。旧引擎时代的宽松归一入口
 * （`withMigrationDriver` / `createLegacyBMapClient`）已随 webgl-v1 一并删除。
 */
export function assertLoadedSdk(value: unknown): LoadedSdk {
  const engine = readEngine(value);
  if (engine === undefined) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      "Provider 必须返回结构化的 LoadedSdk（engine + version + namespace + load metadata），" +
        "不接受裸 SDK unknown；手工构造请用公开的 createLoadedJsapiV4()",
    );
  }
  if (engine !== JSAPI_V4_ENGINE) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      `只接受 engine=${JSAPI_V4_ENGINE} 的加载结果，收到 engine=${String(engine)}；` +
        "本库只支持 JSAPI 4.0，请改用 v4 Provider 家族（官方 jsapi-loader / 自定义脚本 / 已有全局）",
      { engine },
    );
  }
  const gaps = describeContractGaps(value);
  if (gaps.length > 0) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      `加载结果声明了 engine=${engine}，但不满足 LoadedSdk 契约：${gaps.join("；")}；` +
        "完整结构请用公开的 createLoadedJsapiV4() 构造，不要手写字面量",
      { engine },
    );
  }
  return value as LoadedSdk;
}
