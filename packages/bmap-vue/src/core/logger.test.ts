import { describe, it, expect, vi, afterEach } from "vitest";
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";
import { BMapError } from "./errors/BMapError";
import { devWarn, isDev, logger, redactAk } from "./logger";

/** 形似真实 AK 的字母数字串（真实 AK 无连字符，`ak=` 模式才匹配得上）。 */
const TEST_AK = "zk8Hq2LmVn4Rt6YwBd0XcFg3Pj5Sa1Nd7Ue9IhMoQ";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactAk", () => {
  it("redacts a known ak in a message", () => {
    const ak = "secret-ak-123456";
    const msg = "config conflict for ak=secret-ak-123456";
    expect(redactAk(msg, ak)).toBe("config conflict for ak=***3456");
  });

  it("redacts ak= pattern when ak not provided", () => {
    const msg = "conflict ak=ABC123XYZ";
    expect(redactAk(msg)).toBe("conflict ak=***3XYZ");
  });

  it("leaves message unchanged when no ak present", () => {
    expect(redactAk("normal message")).toBe("normal message");
  });
});

/**
 * 上下文清洗（#163）
 *
 * 缺口形态：`logger` 只对 `message` 调 `redactAk`，第二个 console 参数 `context` 原样输出，
 * 于是 `context.error`、URL、options 全部绕过清洗。这里把「context 也不得带出完整 AK」
 * 与「context 只投影有限普通数据」两件事钉成可观察行为。
 */
describe("logger 上下文清洗（#163）", () => {
  /** 收集一条日志的**所有** console 参数，压成一段文本——「有没有漏」只认这个口径。 */
  function capturedText(args: unknown[]): string {
    const safe = args.map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message} ${a.stack ?? ""}`;
      return safeStringify(a);
    });
    return safe.join(" | ");
  }

  function safeStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    });
  }

  it("context 里的 AK 字段不再原样输出（旧实现只清洗 message 的缺口）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.warn("加载失败", { ak: TEST_AK, serviceHost: `https://x.example/?ak=${TEST_AK}` });

    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text, "context 参数里也不得出现完整 AK").not.toContain(TEST_AK);
    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    // 凭据**键名**（`ak`）整体不输出——但键名本身要留下来（「哪个字段被清掉」是定位信息）。
    expect(output?.ak).toBe("[redacted]");
    // `serviceHost` 不在拒识清单里（#163 评审核过：零调用点传它），它靠**值**的形状脱敏：
    // URL 的非凭据部分（`https://x.example/?`）照常可读，`ak=` 参数被打码。
    expect(output?.serviceHost).toBe("https://x.example/?ak=***hMoQ");
  });

  it("context 里的错误信息（带 AK 的 message）同样过清洗，且保留错误码", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new BMapError(
      "BMAP_SDK_LOAD_FAILED",
      `脚本加载失败: https://api.map.baidu.com/api?ak=${TEST_AK}&v=4.0`,
    );

    logger.warn("ResourceScope dispose failed (map-runtime)", { error: failure });

    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text).not.toContain(TEST_AK);
    // 错误码是**定位信息**的主要来源，必须保留。
    expect(text, "错误码要留下来").toContain("BMAP_SDK_LOAD_FAILED");
    expect(text, "脱敏后的错误文本要留下来").toContain("加载失败");
    expect(text, "作用域名要留下来").toContain("map-runtime");
  });

  it("message 里的 `ak=` 仍按既有形状脱敏（不回归）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn(`冲突 ak=${TEST_AK}`);
    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text).not.toContain(TEST_AK);
    expect(text).toContain("ak=***");
  });

  it("原始 Error / cause / SDK-like 对象不被原样透传，也不被深遍历", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let toJSONCalls = 0;
    const sdkLike = {
      toJSON() {
        toJSONCalls += 1;
        return { leaked: "should-not-be-called" };
      },
      getZoom: () => 12,
    };
    const cause = new Error("原始 cause");
    const error = new Error("外层", { cause });

    logger.warn("销毁失败", { error, sdkLike });

    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(toJSONCalls, "日志不得主动调用任意对象的 toJSON()").toBe(0);
    expect(text, "原始 cause 不进日志").not.toContain("原始 cause");
    expect(text, "不得原样带出 SDK-like 对象的自定义投影").not.toContain("should-not-be-called");
    // 必要的定位字段仍在。
    expect(text).toContain("外层");
  });

  it("带环对象 / 大数组：不崩溃、不原样透传、不为日志深遍历", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cyclic: Record<string, unknown> = { kind: "Marker" };
    cyclic.self = cyclic;

    // 代理记录「被枚举过几次」，用来证明我们没有整棵深遍历。
    let enumerated = 0;
    const huge = new Proxy(
      {},
      {
        ownKeys() {
          enumerated += 1;
          throw new Error("不该被深遍历");
        },
      },
    );

    expect(() => logger.warn("释放失败", { cyclic, huge })).not.toThrow();
    expect(enumerated, "不为日志深遍历未知对象").toBe(0);
    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text).toContain("释放失败");
  });

  it("不修改传入对象，也不把原始引用交给 console", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nested = { ak: TEST_AK, secret: "keep-me-in-place" };
    const context = { error: nested, count: 3 };

    logger.warn("失败", context);

    expect(nested, "输入对象不被改写").toEqual({ ak: TEST_AK, secret: "keep-me-in-place" });
    expect(context).toEqual({ error: nested, count: 3 });
    const output = warn.mock.calls[0]?.[1];
    expect(output, "交给 console 的不是原始 context 引用").not.toBe(context);
    expect(output).not.toBe(nested);
  });

  it("未知嵌套对象退化为占位，不展开字段", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("失败", { payload: { a: 1, b: 2, c: 3 } });
    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(output?.payload, "未知对象只留占位").toBe("[object]");
  });

  it("大型数组不原样透传，也不为日志逐项深遍历", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, ak: `row-secret-${i}` }));

    logger.warn("批量导入", { rows });

    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(output?.rows, "数组只留规模信息").toBe("[1000 items]");
    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text).not.toContain("row-secret-");
  });

  it("键名不带凭据字样的普通字段，值里的 AK 仍要清洗（评审抓到的漏网）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `detail` / `note` / `href` 这类键名不带 ak/auth/token，但值完全可能就是整条入口 URL。
    // 旧实现只截断 120 字符就原样输出——而一条典型入口 URL 只有 77 字符，截断压根不触发。
    const detail = `https://api.map.baidu.com/api?v=4.0&ak=${TEST_AK}`;
    expect(detail.length, "这条串比截断阈值短 ⇒ 截断救不了它").toBeLessThan(120);

    logger.warn("加载失败", { detail, note: `ak=${TEST_AK}` });

    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text, "context 普通字段里的 AK 同样不得原样输出").not.toContain(TEST_AK);
    // 定位信息仍在：URL 的非凭据部分照常可读。
    expect(text).toContain("api.map.baidu.com");
  });

  it("两个操作各自持有不同 AK 时互不依赖（不靠最后一次全局 setter）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setAkForLogger } = (await import("./logger")) as unknown as Record<string, unknown>;
    expect(
      setAkForLogger,
      "无消费者的全局 AK setter 已删除（不该再有调用点依赖它）",
    ).toBeUndefined();

    // AK 走**不带凭据字样的键名**（`detail`）⇒ 这里考的是「每个操作各自清洗自己的 AK」，
    // 而不是「`ak` 这个键名会被整体拒识」——后者让断言恒真，证明不了任何事。
    const akA = "akAaaaaaaaaaaaaaaaaaaaaaaa";
    const akB = "akBbbbbbbbbbbbbbbbbbbbbbbbbb";
    logger.warn("Client A 加载失败", { detail: `https://x.example/?ak=${akA}` });
    logger.warn("Client B 加载失败", { detail: `https://y.example/?ak=${akB}` });
    logger.warn("Client A 再次加载失败", { detail: `https://x.example/?ak=${akA}` });

    // 交错进行 ⇒ 若是「最后一次写入的全局 AK」语义，B 会用 A 的值去清洗而漏掉自己。
    expect(capturedText(warn.mock.calls[0] ?? []), "A 独立清洗").not.toContain(akA);
    expect(capturedText(warn.mock.calls[1] ?? []), "B 独立清洗").not.toContain(akB);
    expect(capturedText(warn.mock.calls[2] ?? []), "A 再次独立清洗").not.toContain(akA);
    // 三条 URL 各自的非凭据部分都还在（清洗没有把整条记录抹掉）。
    const bContext = warn.mock.calls[1]?.[1] as Record<string, unknown> | undefined;
    expect(bContext?.detail).toContain("y.example");
  });

  it("context 带抛错 getter 时异常仍被隔离在日志边界内", () => {
    // `ak` 是一次普通属性访问：调用方传带 getter 的对象时，它必须在 `try` 之内，
    // 否则异常会顺着业务路径逸出——恰好是「日志不得中断业务」要防的那件事。
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostile = {
      get ak(): string {
        throw new Error("getter 炸了");
      },
    };
    expect(() => logger.warn("释放失败", hostile)).not.toThrow();
    expect(() => logger.warn("释放失败", { error: hostile })).not.toThrow();
  });

  it("凭据字段名按记号判定，不误伤含 ak/sign 的普通词", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 子串匹配会命中 `make` / `break` / `brake`（含 `ak`）与 `design` / `assign`（含 `sign`）。
    // 误伤比漏网更隐蔽：字段被静默打成 [redacted]，没人会怀疑是清洗规则干的。
    logger.warn("释放失败", {
      make: "左",
      brake: "手刹",
      design: "v2",
      mapId: "map-a",
      kind: "Marker",
      itemKey: "k1",
      layerKind: "vector",
      BMAP_SERVICE_FAILED: "BMAP_SERVICE_FAILED",
      xApiKey: "should-be-dropped",
      AK: TEST_AK,
    });
    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(output?.make).toBe("左");
    expect(output?.brake).toBe("手刹");
    expect(output?.design).toBe("v2");
    expect(output?.mapId).toBe("map-a");
    expect(output?.kind).toBe("Marker");
    expect(output?.itemKey).toBe("k1");
    expect(output?.layerKind).toBe("vector");
    expect(output?.BMAP_SERVICE_FAILED).toBe("BMAP_SERVICE_FAILED");
    // 驼峰 `xApiKey` 与大写 `AK` 仍被判为凭据
    expect(output?.xApiKey).toBe("[redacted]");
    expect(output?.AK).toBe("[redacted]");
  });

  it("全大写凭据字段不再被驼峰切分拆散（#163 复审 P1）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `(?=[A-Z])` 前瞻会把 `API_KEY` 拆成 `A`/`P`/`I`/`K`/`E`/`Y` —— 常见凭据字段于是
    // 全部匹配不上。值是**裸 AK**（不带 `ak=` 前缀），`logSafeText` 也不命中，直接原样进 console。
    logger.warn("鉴权失败", {
      API_KEY: TEST_AK,
      TOKEN: TEST_AK,
      PASSWORD: TEST_AK,
      SECRET: TEST_AK,
      CREDENTIALS: TEST_AK,
      accessToken: TEST_AK,
      clientSecret: TEST_AK,
    });
    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    for (const key of [
      "API_KEY",
      "TOKEN",
      "PASSWORD",
      "SECRET",
      "CREDENTIALS",
      "accessToken",
      "clientSecret",
    ]) {
      expect(output?.[key], `${key} 必须被判为凭据字段`).toBe("[redacted]");
    }
    expect(capturedText(warn.mock.calls[0] ?? []), "任何参数都不得带出裸 AK").not.toContain(TEST_AK);
  });

  it("Error 的 name / code 同样过清洗（#163 复审 P1）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `name` 看着只是类名，但自定义 / SDK 的 Error 可能把凭据塞进去。同一个函数里
    // `message` 清洗而 `name` 不清洗，是最容易被漏、也最容易被自查误认为「已清过」的不一致。
    const hostile = new Error("boom");
    hostile.name = `ak=${TEST_AK}`;
    (hostile as { code?: unknown }).code = "https://user:pass@host";

    logger.warn("释放失败", { error: hostile });

    const text = capturedText(warn.mock.calls[0] ?? []);
    expect(text, "name 里的 AK 不得原样输出").not.toContain(TEST_AK);
    expect(text, "code 里的 userinfo 不得原样输出").not.toContain("user:pass@");
    const output = warn.mock.calls[0]?.[1] as { error: Record<string, unknown> } | undefined;
    expect(output?.error.name).toContain("ak=***");
    expect(output?.error.code).toBe("https://***@host");
  });

  it("userinfo 整段打码：token 在 username 位与无冒号形状都盖住（#163 复审 P1）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 只遮 `user:***@` 盖不住 `https://<token>:x@host`，而无冒号的 `https://<token>@host`
    // 压根不匹配 —— 与 `core/loader/url.ts` 的 `maskUserinfo`（整段遮盖）同口径。
    logger.warn("代理入口", {
      a: `https://${TEST_AK}@host/path`,
      b: `https://user:${TEST_AK}@host`,
    });
    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(output?.a).toBe("https://***@host/path");
    expect(output?.b).toBe("https://***@host");
    expect(capturedText(warn.mock.calls[0] ?? [])).not.toContain(TEST_AK);
    // 兜底：不含凭据的 URL 一律不动（否则就成了「见 URL 就打码」的假防护）
    logger.warn("正常", { c: "https://api.map.baidu.com/api?v=4.0" });
    const ok = warn.mock.calls[1]?.[1] as Record<string, unknown> | undefined;
    expect(ok?.c).toBe("https://api.map.baidu.com/api?v=4.0");
  });

  it("symbol mapId 不在投影中丢失（#163 复审 P2）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // `BMapErrorOptions.mapId` 是 `symbol | string`。只留 string 分支会让 symbol mapId
    // 整个消失 —— 而它正是「哪张图」的定位信息。
    const error = new BMapError("BMAP_SDK_LOAD_FAILED", "失败", { mapId: Symbol("map-a") });
    logger.warn("释放失败", { error });
    const output = warn.mock.calls[0]?.[1] as { error: Record<string, unknown> } | undefined;
    expect(output?.error.mapId, "symbol mapId 要留下").toBe("Symbol(map-a)");

    // string mapId 走清洗路径（含 AK 时被打码）
    const withAk = new BMapError("BMAP_SDK_LOAD_FAILED", "失败", { mapId: `ak=${TEST_AK}` });
    logger.warn("释放失败", { error: withAk });
    const out2 = warn.mock.calls[1]?.[1] as { error: Record<string, unknown> } | undefined;
    expect(String(out2?.error.mapId)).not.toContain(TEST_AK);
  });

  it("有限普通数据原样保留（清洗不等于丢字段）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("不支持的能力", { capability: "map.viewAnimation", engine: "jsapi-v4" });
    const output = warn.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(output).toMatchObject({ capability: "map.viewAnimation", engine: "jsapi-v4" });
  });
});

/** 输出路径：复用同一个函数，不再每条日志重建 Logger 对象与闭包（#163 目标 2.3）。 */
describe("logger 输出路径（#163）", () => {
  it("每条日志复用同一个 logger 对象（不重建 emit 闭包）", () => {
    // 旧实现 `logger.warn` 每次都 `makeLogger()`；新实现的 Logger 身份必须稳定。
    const before = logger.warn;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("a");
    logger.warn("b");
    expect(logger.warn, "logger 的方法身份在两次调用之间保持不变").toBe(before);
  });

  it("前缀与通道分流保持不变", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    logger.warn("w");
    logger.error("e");
    logger.debug("d");

    expect(warn.mock.calls[0]?.[0]).toBe("[bmap-vue] w");
    expect(error.mock.calls[0]?.[0]).toBe("[bmap-vue] e");
    expect(debug.mock.calls[0]?.[0]).toBe("[bmap-vue] d");
  });
});

/** 故障隔离：日志自身抛错不得中断业务（#163 目标 3）。 */
describe("logger 故障隔离（#163）", () => {
  it("console.warn 抛错时被吞掉，不把异常抛回业务路径", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console 坏了");
    });
    expect(() => logger.warn("业务仍在跑")).not.toThrow();
  });

  it("日志自身失败不被递归报告（不无限递归输出）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console 坏了");
    });
    // 若实现用 logger 报告 logger 失败，这里会栈溢出。
    expect(() => logger.warn("一次")).not.toThrow();
    expect(() => logger.error("两次")).not.toThrow();
    expect(warn.mock.calls.length, "失败不产生额外的补偿输出").toBe(1);
  });
});

/**
 * `devWarn` 的环境判定（#27 评审第二轮 P2）
 *
 * 判定读的是 `process.env.NODE_ENV`：在 Node / SSR 下它是真实环境变量，在浏览器里由**消费方**
 * 的打包器折叠。下面两条分别钉住两个终态（消费方 dev server ⇒ 折叠成 `"development"`；
 * production build ⇒ 折叠成 `"production"`）。
 */
describe("devWarn", () => {
  it("非 production 环境输出（消费方 dev server 折叠后的形态）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      devWarn("hello");
      expect(warn).toHaveBeenCalledWith("[bmap-vue] hello", "");
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("production 环境静默（消费方 production build 折叠后的形态）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      devWarn("hello");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  /** 静音路径必须在**投影 / 格式化之前**返回（#163 目标 3）。 */
  it("production 静音路径不处理 context（连投影都不做）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let toJSONCalls = 0;
    const hostile = {
      get boom() {
        throw new Error("静音路径不该碰我");
      },
      toJSON() {
        toJSONCalls += 1;
        return {};
      },
    };
    try {
      expect(() => devWarn("hello", { hostile })).not.toThrow();
      expect(warn).not.toHaveBeenCalled();
      expect(toJSONCalls, "静音路径不处理 context").toBe(0);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

/** 告警去重的 once 语义不退化（#163 验收表最后一行）。 */
describe("createDevWarnOnce", () => {
  // 这条是**不退化**的护栏，不是 #163 新增的能力：`createDevWarnOnce` 的实现本票没动，
  // 但它经过同一条 `emit` 输出路径（投影 + 隔离），所以要钉住 once 语义没被改坏。
  it("同一 key 只报一次，不同 key 各报一次（once 语义不退化）", async () => {
    const { createDevWarnOnce } = await import("./logger");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const warnOnce = createDevWarnOnce();
      warnOnce("k1", "第一条");
      warnOnce("k1", "第一条");
      warnOnce("k2", "第二条");
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

describe("isDev：裸浏览器没有 process 时不能崩（#137 复审十轮 P0）", () => {
  /**
   * 这条回归测试的存在理由：单测跑在 Node 里，`process` **永远存在**，所以「裸 `process` 会
   * 抛 `ReferenceError`」这件事在普通用例里**测不出来**。必须在一个真的没有 `process` 的
   * 上下文里求值。
   *
   * 真实故障形态（`smoke-v4-fixture` 抓到）：产物里 `process.env?.NODE_ENV` 被折叠成
   * `process.env.NODE_ENV`，裸 browser ESM 执行 `<Map>` setup ⇒ `ReferenceError: process is
   * not defined` ⇒ 每个依赖 Map ready 的 required check 都被 block。
   */
  it("在没有 process 的上下文中求值不抛", () => {
    // 取源码里的判定表达式本身（而不是调 isDev()）——后者在本进程里必然有 process，
    // 走不到那条分支。`node:vm` 造一个**空**全局，等价于浏览器的裸 ESM 环境。
    // vitest 跑在浏览器语义的环境里，`import.meta.url` 不是 file: 协议，所以用相对 cwd 的路径。
    const source = readFileSync("packages/bmap-vue/src/core/logger.ts", "utf8");
    const expr = /return (typeof process[^\n]*);/.exec(source)?.[1];
    expect(expr, "能从 logger.ts 里取出 isDev 的判定表达式").toBeTypeOf("string");

    const sandbox: Record<string, unknown> = {};
    createContext(sandbox);
    // 不抛就是通过；显式断言返回值让「返回 dev」这件事也被钉住。
    expect(runInContext(`(${expr})`, sandbox), "裸浏览器应视为 dev（不崩优先）").toBe(true);
  });

  it("Node 环境下仍读真实环境变量（不因为加保护就一律当 dev）", () => {
    const original = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(isDev(), "production 应为 false").toBe(false);
      process.env.NODE_ENV = "development";
      expect(isDev(), "development 应为 true").toBe(true);
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});
