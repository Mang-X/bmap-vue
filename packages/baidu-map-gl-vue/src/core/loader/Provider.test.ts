/**
 * legacy（webgl-v1）Provider 的 `cancellable` 契约
 *
 * 三个 legacy Provider 的第一步与 v4 的 `reuseExistingJsapiV4()` 同形：**同步**采纳页面里
 * 已有的全局。`SdkRegistry.start()` 是在 microtask 里调用 loader 的，因此「调用方 load 后
 * 立刻 abort」时，若这条捷径不看聚合 signal，被取消的任务仍会成功结算并抢走域记账。
 *
 * 这里只钉这一条契约（其余 legacy 语义由 `tests/behavior/**` 覆盖；legacy 实现随 #26 删除）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { baiduCdnProvider, customScriptProvider } from "./Provider";
import { resetProcessSdkRegistryForTests } from "./SdkRegistry";

const AK = "ak-abcdef123456";

function installGlobal(value: unknown): void {
  (globalThis as { BMap?: unknown }).BMap = value;
}

afterEach(() => {
  delete (globalThis as { BMap?: unknown }).BMap;
  resetProcessSdkRegistryForTests();
});

describe("legacy Provider：同步复用全局前必须尊重聚合 signal", () => {
  it.each([
    ["baiduCdnProvider", () => baiduCdnProvider()],
    ["customScriptProvider", () => customScriptProvider("https://sdk.example.com/api")],
  ])("%s：被取消的任务不得在复用捷径里成功结算", async (_name, create) => {
    installGlobal({ Map: () => {} });
    const provider = create();
    const c1 = new AbortController();

    const first = provider.load({ ak: AK }, c1.signal);
    c1.abort();
    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    // 被取消的任务不得把域记到自己头上：另一份配置必须能正常复用同一份全局。
    await expect(provider.load({ ak: "ak-other-000000" })).resolves.toMatchObject({
      engine: "webgl-v1",
    });
  });
});
