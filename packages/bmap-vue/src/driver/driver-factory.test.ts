/**
 * Driver 工厂与 engine 收口（M3A1-CLIENT / #18；M3A.2 装配收口 / #23；M3A3-REMOVE-LEGACY / #26）
 *
 * M3A1-CLIENT 把「运行时 engine 猜测」从默认 Client 路径移除；`#26` 删掉旧引擎后，
 * `detectEngine`（猜测）与 `createDriver`（多 engine 分派）**一并删除**——构造 Driver 的
 * 唯一入口是 `createJsapiV4Driver`，它要求调用方显式给出 SDK 运行时版本，不再猜。
 *
 * 因此本文件断言两件事：
 * 1. 装配契约本身（#23 交付的那一组）；
 * 2. **那两个入口不再存在**——「删除」如果只靠 diff 检查，下一个人复制粘贴一段旧代码就能加回来。
 */
import { describe, it, expect } from "vitest";
import { createFakeBMapV4 } from "../../../test-utils";
import * as driverIndex from "./index";
import { createJsapiV4Driver } from "./index";

const fakeSdk = { Map: class {}, Point: class {}, Marker: class {}, VERSION: "1.0" };

/** 合法的 v4 命名空间（装配需要 Map/Point/Pixel/Size/Bounds 齐全）。 */
function v4Namespace() {
  return createFakeBMapV4().namespace;
}

describe("engine 猜测与分派入口已删除（#26）", () => {
  it("`detectEngine` / `createDriver` 不再从 Driver 入口导出", () => {
    expect("detectEngine" in driverIndex).toBe(false);
    expect("createDriver" in driverIndex).toBe(false);
  });

  it("旧引擎的版本探测（`detectVersion`）也不再导出", () => {
    // `detectVersion` 原来住在 `driver/webgl-v1/createDriver.ts`；它随该目录一起删除。
    // v4 的 SDK 版本一律来自结构化加载结果（Provider 声明），Driver 不再探测。
    expect("detectVersion" in driverIndex).toBe(false);
  });

  it("命名空间不完整时按 SDK 边界失败（不是「能力不支持」）", () => {
    // fakeSdk 缺 Pixel/Size/Bounds（v4 命名空间的必需成员）——错误码是「调用失败」而不是
    // 「能力不支持」：这是「加载成功但命名空间不可用」，重试没有意义。
    expect(() =>
      createJsapiV4Driver({ rawSdk: fakeSdk, version: "1.0", unsupported: "warn" }),
    ).toThrowError(expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }));
  });
});

describe("createJsapiV4Driver（#23 装配）", () => {
  it("装出全部 Facet，engine/version/rawSdk 与入参一致", () => {
    const namespace = v4Namespace();
    const driver = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });

    expect(driver.engine).toBe("jsapi-v4");
    expect(driver.version).toBe("4.0");
    expect(driver.rawSdk).toBe(namespace);
    expect(driver.capabilities.supports("overlay.marker")).toBe(true);

    for (const facet of [
      "geometry",
      "events",
      "map",
      "overlays",
      "controls",
      "layers",
      "services",
      "panorama",
      "nativeLayers",
    ] as const) {
      expect(driver[facet], `Facet ${facet} 未装配`).toBeTruthy();
    }
  });

  it("v4 独有面可用：原生图层、归一化服务调用、全景 viewer", () => {
    const namespace = v4Namespace();
    const driver = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });

    expect(driver.nativeLayers.supports("line", "setVisible")).toBe(true);
    expect(driver.nativeLayers.supports("heatmap", "setVisible")).toBe(false);
    expect(driver.panorama.supported).toBe(true);
    expect(driver.services.createGeocoder().raw).toBeTruthy();
  });

  it("每次装配一份独立的 Handle Registry：跨 Client 句柄被拒绝", () => {
    const namespace = v4Namespace();
    const a = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });
    const b = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });

    const handle = a.services.createGeocoder();
    expect(() => b.services.geocode(handle, { address: "北京市海淀区中关村" })).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });

  it("命名空间缺成员时按 SDK 边界失败，并指出缺了哪些", () => {
    expect(() =>
      createJsapiV4Driver({ rawSdk: { Map: class {} }, version: "4.0", unsupported: "warn" }),
    ).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_CALL_FAILED",
        message: expect.stringContaining("Point"),
      }),
    );
  });
});
