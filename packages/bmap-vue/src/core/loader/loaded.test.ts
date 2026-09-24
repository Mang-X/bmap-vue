/**
 * `LoadedSdk` 的运行时收口（M3A1-CLIENT / #18；M3A3-REMOVE-LEGACY / #26 收紧）
 *
 * `assertLoadedSdk()` 是**运行时**边界：JS 消费者、`any`、第三方 Provider 都能绕过静态类型，
 * 因此它必须与公开契约（`LoadedJsapiV4` = `engine` + `version` + `namespace` + `load` metadata）
 * **一致**地 fail-fast。此前只校验 `engine` 与 `namespace`，于是
 * `{ engine: "jsapi-v4", namespace }` 会被收窄成完整结果，`createBMapClient()` 读到
 * `version: undefined` 并把它传给 Driver，最终 `client.sdkVersion` 都是
 * `undefined`——一个「类型上不可能、运行期照样发生」的半成品。
 *
 * 这里逐项钉住「缺什么就拒什么」，并保证报错点名到具体字段（否则调用方只能靠猜）。
 */
import { describe, it, expect } from "vitest";
import { createFakeBMapV4 } from "../../../../test-utils";
import { createLoadedJsapiV4 } from "./providers/index";
import { assertLoadedSdk, isLoadedSdk } from "./loaded";

const namespace = () => createFakeBMapV4().namespace;

/** 完整、合法的结构化加载结果（对照基准）。 */
const valid = () =>
  createLoadedJsapiV4({
    providerId: "custom-script-v4",
    mode: "load",
    version: "4.0",
    versionSource: "declared",
    options: { ak: "ak-abcdef1234" },
    fingerprint: "fp-loaded-test",
    namespace: namespace(),
  });

function expectRejected(value: unknown, field: string): void {
  expect(isLoadedSdk(value), `${field}: isLoadedSdk 不应放行`).toBe(false);
  expect(() => assertLoadedSdk(value), `${field}: assertLoadedSdk 不应放行`).toThrowError(
    expect.objectContaining({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining(field),
    }),
  );
}

describe("LoadedSdk 的运行时校验与契约一致", () => {
  it("接受完整结构化结果，并原样返回", () => {
    const loaded = valid();
    expect(isLoadedSdk(loaded)).toBe(true);
    expect(assertLoadedSdk(loaded)).toBe(loaded);
  });

  it("缺 `version` 被拒绝（否则 client.sdkVersion 会变成 undefined）", () => {
    const { version, ...rest } = valid();
    void version;
    expectRejected(rest, "version");
  });

  it("`version` 不是非空字符串被拒绝", () => {
    expectRejected({ ...valid(), version: "" }, "version");
    expectRejected({ ...valid(), version: 4 }, "version");
  });

  it("缺 `namespace` 被拒绝（raw SDK 逃生口是必填的）", () => {
    const { namespace: ns, ...rest } = valid();
    void ns;
    expectRejected(rest, "namespace");
  });

  it("`namespace` 为 null 被拒绝", () => {
    expectRejected({ ...valid(), namespace: null }, "namespace");
  });

  it("缺 `load` metadata 被拒绝", () => {
    const { load, ...rest } = valid();
    void load;
    expectRejected(rest, "load");
  });

  it("`load` 不是对象被拒绝", () => {
    expectRejected({ ...valid(), load: "none" }, "load");
  });

  it("`load` 缺必填字段时点名到具体字段", () => {
    const { fingerprint, ...loadWithoutFingerprint } = valid().load;
    void fingerprint;
    expectRejected({ ...valid(), load: loadWithoutFingerprint }, "fingerprint");
  });

  it("`load.loadedAt` 不是数字被拒绝", () => {
    expectRejected({ ...valid(), load: { ...valid().load, loadedAt: "now" } }, "loadedAt");
  });

  it("已删除的 engine 取值（webgl-v1）被拒绝，且文案指向唯一受支持的引擎", () => {
    expect(isLoadedSdk({ engine: "webgl-v1", namespace: namespace() })).toBe(false);
    expect(() => assertLoadedSdk({ engine: "webgl-v1", namespace: namespace() })).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_ENGINE_MISMATCH",
        message: expect.stringContaining("本库只支持 JSAPI 4.0"),
      }),
    );
  });

  it("裸全局对象（没有 engine 判别字段）被拒绝，并指引用 createLoadedJsapiV4() 构造", () => {
    expect(isLoadedSdk(namespace())).toBe(false);
    expect(() => assertLoadedSdk(namespace())).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_ENGINE_MISMATCH",
        message: expect.stringContaining("createLoadedJsapiV4"),
      }),
    );
  });
});
