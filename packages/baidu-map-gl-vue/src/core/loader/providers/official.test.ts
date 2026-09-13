/**
 * 官方 Loader 适配边界（R25-B / issue #71）
 *
 * 这一层把「默认路径只经官方 `@baidumap/jsapi-loader` 加载」变成可单测的规则：
 * 选项映射、上游没有入口的配置**必须显式报错**（接收后忽略属于假支持）、错误码与
 * AK 脱敏、以及「官方 resolve 出来的东西是不是可用命名空间」的判定。
 */
import { describe, expect, it } from "vitest";
import { BMapError } from "../../errors/BMapError";
import { DEFAULT_VERSION } from "../url";
import {
  OFFICIAL_LOADER_UNSUPPORTED_KEYS,
  officialEntryUrl,
  toOfficialLoadError,
  toOfficialLoadOptions,
  resolveOfficialNamespace,
} from "./official";

const AK = "ak-abcdef123456";
const COMPLETE_NAMESPACE = { Map: () => {}, Point: () => {}, Marker: () => {} };

describe("toOfficialLoadOptions", () => {
  it("映射 ak / version / timeout，并把 version 缺省收敛到 4.0", () => {
    expect(toOfficialLoadOptions({ ak: AK }, "baidu-jsapi-v4")).toEqual({
      ak: AK,
      version: DEFAULT_VERSION,
      timeout: 0,
    });
    expect(
      toOfficialLoadOptions({ ak: AK, version: "4.0", timeout: 5000 }, "baidu-jsapi-v4"),
    ).toMatchObject({ version: "4.0", timeout: 5000 });
  });

  it("timeout: 0 原样传给官方（0 = 不超时，不是「用默认值」）", () => {
    // 官方契约：`0` 表示不超时。这里不能因为 `0` 为 falsy 就丢掉它。
    expect(toOfficialLoadOptions({ ak: AK, timeout: 0 }, "baidu-jsapi-v4").timeout).toBe(0);
    // 未设置时同样是 0（官方默认），两者语义一致。
    expect(toOfficialLoadOptions({ ak: AK }, "baidu-jsapi-v4").timeout).toBe(0);
  });

  it("官方 v4 只认 '4.0'：其它 4.x 版本号显式失败，不静默按 4.0 加载", () => {
    const error = (() => {
      try {
        toOfficialLoadOptions({ ak: AK, version: "4.1" }, "baidu-jsapi-v4");
        return undefined;
      } catch (caught) {
        return caught as BMapError;
      }
    })();
    expect(error).toBeInstanceOf(BMapError);
    expect(error!.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(error!.message).toContain("4.1");
    expect(error!.message).toContain("customScriptV4Provider");
  });

  it("代理模式：serviceHost 原样透传，且不要求 ak", () => {
    // 官方契约：`serviceHost` 与 `ak` 二选一（`必须提供 ak，或配置 serviceHost 使用代理模式`），
    // 且代理模式 URL 不带 ak。官方 React 封装（react-bmap 的 <BMapProvider serviceHost>）也把它
    // 当作「隐藏 ak / 走代理」的公开入口，因此默认路径必须能表达它。
    expect(
      toOfficialLoadOptions(
        { serviceHost: "https://proxy.example/_BMapService" },
        "baidu-jsapi-v4",
      ),
    ).toEqual({
      version: DEFAULT_VERSION,
      timeout: 0,
      serviceHost: "https://proxy.example/_BMapService",
    });
    // 末尾斜杠由官方 Loader 自己补并 warn，这里不代它归一化。
    expect(
      toOfficialLoadOptions({ ak: AK, serviceHost: "https://proxy.example/svc/" }, "baidu-jsapi-v4"),
    ).toMatchObject({ ak: AK, serviceHost: "https://proxy.example/svc/" });
  });

  it("入口 metadata 必须按官方实际入口构造：代理模式走 serviceHost 且不带 ak", () => {
    // 官方 `L()`：`{serviceHost}/api?v=4.0[&ak=...]&callback=...`，其中 **只有非代理模式**才带 ak。
    expect(
      officialEntryUrl({ serviceHost: "https://proxy.example/_BMapService/" }),
    ).toBe(`https://proxy.example/_BMapService/api?v=${DEFAULT_VERSION}`);
    // 末尾斜杠缺了时官方会补并 warn，metadata 记录的是**实际**入口，因此同样补上。
    expect(officialEntryUrl({ serviceHost: "https://proxy.example/svc" })).toBe(
      `https://proxy.example/svc/api?v=${DEFAULT_VERSION}`,
    );
    // 同时给了 ak：代理模式下它不参与入口，metadata 不能假装它参与了。
    expect(
      officialEntryUrl({ ak: AK, serviceHost: "https://proxy.example/svc/" }),
    ).not.toContain("ak=");
    // 非代理模式维持原样：CDN 入口带 ak（对外前由 createLoadedJsapiV4 脱敏），且不含回调参数。
    const cdn = officialEntryUrl({ ak: AK });
    expect(cdn).toContain("api.map.baidu.com/api");
    expect(cdn).toContain(`v=${DEFAULT_VERSION}`);
    expect(cdn).toContain(`ak=${AK}`);
    expect(cdn).not.toContain("callback");
  });

  it("上游没有入口的配置一律显式失败，并指向合法替代", () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ nonce: "n-1" }, /nonce/],
      [{ integrity: "sha384-x" }, /integrity/],
      [{ crossOrigin: "anonymous" }, /crossOrigin/],
      [{ referrerPolicy: "no-referrer" }, /referrerPolicy/],
      [{ apiUrl: "https://self.hosted/api" }, /customScriptV4Provider/],
      [{ callbackParam: "cb" }, /callbackParam/],
      [{ language: "zh-CN" }, /language/],
    ];
    for (const [extra, pattern] of cases) {
      let error: unknown;
      try {
        toOfficialLoadOptions({ ak: AK, ...extra } as never, "baidu-jsapi-v4");
      } catch (caught) {
        error = caught;
      }
      expect(error, `${Object.keys(extra)[0]} 必须显式报错`).toBeInstanceOf(BMapError);
      expect((error as BMapError).code).toBe("BMAP_INVALID_ARGUMENT");
      expect((error as BMapError).message).toMatch(pattern);
      // 不支持的键必须点名，便于调用方定位
      expect((error as BMapError).message).toContain(Object.keys(extra)[0]!);
    }
  });

  it("把不支持项清单作为常量暴露出来（文档与测试共用同一份口径）", () => {
    expect([...OFFICIAL_LOADER_UNSUPPORTED_KEYS]).toEqual([
      "nonce",
      "integrity",
      "crossOrigin",
      "referrerPolicy",
      "apiUrl",
      "callbackParam",
      "language",
    ]);
  });

  it("空字符串等「没有实义取值」不算配置，不触报错", () => {
    expect(() =>
      toOfficialLoadOptions({ ak: AK, nonce: undefined, apiUrl: "" }, "baidu-jsapi-v4"),
    ).not.toThrow();
  });
});

describe("toOfficialLoadError", () => {
  it("官方超时文案映射成 BMAP_SDK_LOAD_TIMEOUT，其余归 BMAP_SDK_LOAD_FAILED", () => {
    const timeout = toOfficialLoadError(new Error("[bmap-loader] JSAPI 加载超时(5ms)"), {
      ak: AK,
    });
    expect(timeout.code).toBe("BMAP_SDK_LOAD_TIMEOUT");
    expect(timeout.message).toContain("加载超时(5ms)");
    // cause 是**脱敏副本**（上游 name + 已脱敏的 message / stack），不是原始 Error：
    // 完整脱敏断言见下一个用例。
    expect(timeout.cause).toBeInstanceOf(Error);
    expect((timeout.cause as Error).message).toContain("加载超时(5ms)");

    const failed = toOfficialLoadError(
      new Error(`[bmap-loader] JSAPI 脚本加载失败: https://api.map.baidu.com/api?ak=${AK}`),
      { ak: AK },
    );
    expect(failed.code).toBe("BMAP_SDK_LOAD_FAILED");
  });

  it("脱敏官方消息里的 AK（两种形态：已知值替换与 `ak=` 模式）", () => {
    const withKnownAk = toOfficialLoadError(
      new Error(`[bmap-loader] JSAPI 脚本加载失败: https://api.map.baidu.com/api?ak=${AK}&v=4.0`),
      { ak: AK },
    );
    expect(withKnownAk.message).not.toContain(AK);
    expect(withKnownAk.message).toContain("***3456");

    // 调用方没传 ak（例如代理模式 / 全局复用）：仍不得把 URL 上的 AK 原样带出去。
    // 用形如真实 AK 的字母数字串——带连字符的串本来就匹配不上 `ak=` 模式（真实 AK 无连字符）。
    const unknownAk = "zzzunknown987654abc";
    const withUnknownAk = toOfficialLoadError(
      new Error(`[bmap-loader] JSAPI 脚本加载失败: https://api.map.baidu.com/api?ak=${unknownAk}`),
      {},
    );
    expect(withUnknownAk.message).not.toContain(unknownAk);
  });

  it("cause 与 toJSON() 都不得泄漏 AK：上游 Error 必须脱敏后才对外暴露", () => {
    // 官方脚本失败消息里带完整入口 URL（含 `ak=`），直接挂到公开 `cause` 上会让
    // Sentry / OpenTelemetry 这类「直接读 cause.message」的上报路径拿到完整 AK。
    const upstream = new Error(
      `[bmap-loader] JSAPI 脚本加载失败: https://api.map.baidu.com/api?ak=${AK}&v=4.0&callback=cb`,
    );
    const error = toOfficialLoadError(upstream, { ak: AK });
    const cause = error.cause as Error;

    expect(cause).toBeInstanceOf(Error);
    expect(cause.message).not.toContain(AK);
    expect(cause.stack ?? "").not.toContain(AK);
    expect(JSON.stringify(error.toJSON())).not.toContain(AK);
    // 上游错误的其它可见字段也不得成为旁路。
    expect(Object.values(cause as unknown as Record<string, unknown>).join(" ")).not.toContain(AK);

    // 「调用方没给 ak」（代理模式 / 全局复用）时同样不能漏。
    const unknownAk = "zzzunknown987654abc";
    const second = toOfficialLoadError(
      new Error(`[bmap-loader] JSAPI 脚本加载失败: https://api.map.baidu.com/api?ak=${unknownAk}`),
      {},
    );
    expect((second.cause as Error).message).not.toContain(unknownAk);
    expect(JSON.stringify(second.toJSON())).not.toContain(unknownAk);
  });

  it("代理入口带 userinfo 时，错误文本与 cause 都不得泄漏用户名 / 密码", () => {
    // 官方脚本失败消息带完整入口 URL；代理入口可能是 `https://user:pass@proxy/...`（HTTP 认证），
    // userinfo 与 AK 同属凭据 ⇒ message / cause.message / cause.stack / toJSON() 四处都要干净。
    const serviceHost = "https://agent:s3cret@proxy.example/_BMapService/";
    const upstream = new Error(
      `[bmap-loader] JSAPI 脚本加载失败: ${serviceHost}api?v=4.0&callback=cb`,
    );
    const error = toOfficialLoadError(upstream, { serviceHost });
    const cause = error.cause as Error;

    for (const text of [error.message, cause.message, cause.stack ?? ""]) {
      expect(text).not.toContain("s3cret");
      expect(text).not.toContain("agent:");
    }
    expect(JSON.stringify(error.toJSON())).not.toContain("s3cret");
    // 诊断价值保留：host 与路径仍在。
    expect(error.message).toContain("proxy.example/_BMapService/api");
  });

  it("非 Error 抛出物也能收敛成结构化错误", () => {
    expect(toOfficialLoadError("boom", { ak: AK }).message).toContain("boom");
  });
});

describe("resolveOfficialNamespace", () => {
  it("官方 resolve 出的命名空间完整时直接使用", () => {
    expect(resolveOfficialNamespace(COMPLETE_NAMESPACE, "baidu-jsapi-v4")).toBe(COMPLETE_NAMESPACE);
  });

  it("结算值与全局都不可用时抛 BMAP_SDK_LOAD_FAILED，并点名缺失成员", () => {
    const error = (() => {
      try {
        resolveOfficialNamespace({ Map: () => {} }, "baidu-jsapi-v4");
        return undefined;
      } catch (caught) {
        return caught as BMapError;
      }
    })();
    expect(error).toBeInstanceOf(BMapError);
    expect(error!.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(error!.message).toMatch(/Point, Marker/);
  });

  it("结算值不可用但全局可用时以全局为准（不误判为失败）", () => {
    (globalThis as { BMap?: unknown }).BMap = COMPLETE_NAMESPACE;
    try {
      expect(resolveOfficialNamespace(undefined, "baidu-jsapi-v4")).toBe(COMPLETE_NAMESPACE);
      // 结算值残缺、全局完整：仍以全局为准。
      expect(resolveOfficialNamespace({ Map: () => {} }, "baidu-jsapi-v4")).toBe(
        COMPLETE_NAMESPACE,
      );
    } finally {
      delete (globalThis as { BMap?: unknown }).BMap;
    }
  });
});
