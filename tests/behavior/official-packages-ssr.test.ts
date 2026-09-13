/**
 * 官方包的 SSR 侧契约（R25-A / issue #70）
 *
 * 这一组固定的是「Node/SSR 消费者 import 这两个包会发生什么」——正是 #71 / #73 / #74
 * 的 SSR 门禁要依据的事实。结论不靠推断，靠**真的在一个无 DOM 的 Node 进程里 import**：
 *
 * 1. `@baidumap/jsapi-loader` 的 ESM 入口可以 import；`load()` 抛 `只能在浏览器环境使用`，
 *    `getStatus()` / `reset()` 无副作用。→ 默认 Provider 可以安全地进入 SSR 模块图。
 * 2. `@baidumap/jsapi-ui-kit` 在无 DOM 时 **import 即失败**：没有 `exports` 字段，Node 走 `main`
 *    （IIFE 产物），模块求值期就访问 `document`。→ UI Kit 只能等浏览器挂载后动态 import。
 *
 * ⚠️ 判定必须区分**运行时失败**与**根本没加载到**（评审第 2 轮指出）：
 * `ERR_MODULE_NOT_FOUND` / `ERR_PACKAGE_PATH_NOT_EXPORTED` 这类解析错误同样是 `Error: ...`，
 * 只匹配 `/^(TypeError|ReferenceError|Error): /` 的话，即使 ESM 文件缺失、代码一行没跑，
 * 用例也会通过——门禁空转，且与「排除解析不到模块」的意图正好相反。
 * 所以这里：子进程回传结构化的 `{name, message, code}`，判定显式排除解析错误码，
 * 并补一条**负向用例**（不存在的子路径必须被判成解析错误、不得被当成 SSR 结论）。
 *
 * 为什么用子进程而不是给本文件切 node 环境：仓库的全局 `tests/setup.ts` 在模块顶层
 * 就给 `window.BMapGL` 赋值，无 DOM 的环境下 setup 本身会先抛 `window is not defined`。
 * 子进程同时也更贴近真实消费者：它走的正是 Node 自己的解析规则（`main` / `module` / `exports`）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

interface PackedManifest {
  name: string;
  version: string;
  main?: string;
  module?: string;
  types?: string;
  style?: string;
  exports?: unknown;
  sideEffects?: boolean;
}

/**
 * 直接读安装目录里的 `package.json`，不走 `require('<pkg>/package.json')`：
 * loader 有 `exports` 且没有 `./package.json` 条目，Node 会直接拒绝该子路径。
 */
function manifestOf(pkg: string): PackedManifest {
  const path = join(repoRoot, "node_modules", pkg, "package.json");
  return JSON.parse(readFileSync(path, "utf8")) as PackedManifest;
}

interface ImportOutcome {
  kind: "resolved" | "failed";
  name?: string;
  message?: string;
  code?: string | null;
}

/** 在无 DOM 的 Node 子进程里 import 一个 specifier，拿结构化结果（不靠 stdout 文本猜）。 */
function importInNode(specifier: string): ImportOutcome {
  const source = `
    const specifier = process.argv[1];
    let outcome;
    try {
      await import(specifier);
      outcome = { kind: "resolved" };
    } catch (error) {
      outcome = {
        kind: "failed",
        name: error.constructor.name,
        message: error.message,
        code: typeof error.code === "string" ? error.code : null,
      };
    }
    console.log(JSON.stringify(outcome));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", source, specifier], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.trim().split("\n").at(-1)!) as ImportOutcome;
}

/** 「模块根本没解析到」这一类失败码：它们**不能**用来证明 SSR 不可用。 */
const RESOLUTION_ERROR_CODES = new Set([
  "ERR_MODULE_NOT_FOUND",
  "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "ERR_UNSUPPORTED_DIR_IMPORT",
  "ERR_INVALID_PACKAGE_TARGET",
  "ERR_INVALID_MODULE_SPECIFIER",
  "MODULE_NOT_FOUND",
]);

/**
 * 判定：这条 import 失败是否发生在**模块求值期**（无 DOM 环境下的运行时失败）。
 *
 * 两条规则缺一不可：
 * 1. 不得是解析类错误（`code` 不在上表里）——解析不到说明文件压根没加载，什么都证明不了；
 * 2. 错误类型必须是求值期抛出的 `TypeError` / `ReferenceError`（Node 解析失败给的是带 `code`
 *    的 `Error`，不是这两类）。
 *
 * 刻意**不**要求 message 里出现 `document`：两个入口的顶层崩溃点不同——IIFE/CJS 入口撞的是
 * `document is not defined`，而 ESM 产物更早死在打包进去的 `js-md5` / `Buffer` interop 上
 * （`Cannot read properties of undefined (reading 'from')`）。两者都是「求值期崩溃」，
 * 但只有前者能靠 message 断言，所以统一按「求值期 + 非解析错误」判。
 */
function isEvaluationTimeFailure(outcome: ImportOutcome): boolean {
  if (outcome.kind !== "failed") return false;
  if (outcome.code && RESOLUTION_ERROR_CODES.has(outcome.code)) return false;
  return outcome.name === "TypeError" || outcome.name === "ReferenceError";
}

describe("包入口形状（锁定版本）", () => {
  it("@baidumap/jsapi-loader：双入口 + 声明 + exports 映射 + sideEffects:false", () => {
    const pkg = manifestOf("@baidumap/jsapi-loader");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.module).toBe("dist/index.mjs");
    expect(pkg.types).toBe("types/index.d.ts");
    expect(pkg.exports).toEqual({
      ".": {
        types: "./types/index.d.ts",
        import: "./dist/index.mjs",
        require: "./dist/index.js",
      },
    });
    expect(pkg.sideEffects).toBe(false);
  });

  it("@baidumap/jsapi-ui-kit：无 exports 字段、main 指向 IIFE、样式单独发布", () => {
    const pkg = manifestOf("@baidumap/jsapi-ui-kit");
    expect(pkg.version).toBe("1.1.2");
    expect(pkg.main).toBe("dist/jsapi-ui-kit.iife.js");
    expect(pkg.module).toBe("dist/jsapi-ui-kit.esm.js");
    expect(pkg.types).toBe("dist/index.d.ts");
    expect(pkg.style).toBe("dist/css/jsapi-ui-kit.css");
    // 没有 exports 字段 ⇒ Node 侧 `import '@baidumap/jsapi-ui-kit'` 落到 main（IIFE），
    // 于是模块求值期就撞 document —— 这正是下面那条 SSR 断言的根因。
    expect(pkg.exports).toBeUndefined();
  });

  it("根 package.json 用精确版本锁定，不带 ^ / ~（否则安装版可能漂移）", () => {
    const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    const pinned = root.devDependencies ?? {};
    expect(pinned["@baidumap/jsapi-loader"]).toBe("1.0.0");
    expect(pinned["@baidumap/jsapi-ui-kit"]).toBe("1.1.2");
  });
});

describe("无 DOM 的 Node 进程里的 import 行为", () => {
  it("对照组：loader 可以 import，load() 拒绝，getStatus/reset 无副作用", () => {
    const source = `
      const mod = await import("@baidumap/jsapi-loader");
      const report = { hasWindow: typeof window !== "undefined", status: mod.getStatus() };
      mod.reset();
      report.statusAfterReset = mod.getStatus();
      try {
        await mod.load({ ak: "test-ak", version: "4.0" });
        report.load = "resolved";
      } catch (error) {
        report.load = String(error.message);
      }
      console.log(JSON.stringify(report));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const report = JSON.parse(output.trim()) as Record<string, string | boolean>;
    expect(report.hasWindow).toBe(false);
    expect(report.status).toBe("notload");
    expect(report.statusAfterReset).toBe("notload");
    expect(String(report.load)).toContain("只能在浏览器环境使用");
  });

  it("jsapi-ui-kit：无 DOM 时 import 失败，且是求值期运行时错误", () => {
    const outcome = importInNode("@baidumap/jsapi-ui-kit");
    expect(outcome.kind).toBe("failed");
    expect(
      isEvaluationTimeFailure(outcome),
      `import 失败的形态变了，需重新核对 #73 的 SSR 策略：${JSON.stringify(outcome)}`,
    ).toBe(true);
    // 走 main（IIFE）时顶层撞的是 document，可以把根因也钉住。
    expect(outcome.message).toContain("document is not defined");
  });

  it("jsapi-ui-kit：即使绕过 main 直接拿 ESM 产物，无 DOM 时同样是求值期运行时错误", () => {
    const outcome = importInNode("@baidumap/jsapi-ui-kit/dist/jsapi-ui-kit.esm.js");
    expect(outcome.kind).toBe("failed");
    expect(isEvaluationTimeFailure(outcome), JSON.stringify(outcome)).toBe(true);
  });

  it("负向：模块根本没解析到时，判定不得把它当成 SSR 结论", () => {
    // 评审复现：包清单与入口都在、只缺 ESM 文件时，旧断言（只匹配 `Error: ` 前缀）会通过，
    // 于是「SSR 契约已验证」这句话在代码一行没跑的情况下也成立。
    const outcome = importInNode("@baidumap/jsapi-ui-kit/dist/jsapi-ui-kit.esm-DOES-NOT-EXIST.js");
    expect(outcome.kind).toBe("failed");
    expect(outcome.code).toBe("ERR_MODULE_NOT_FOUND");
    expect(
      isEvaluationTimeFailure(outcome),
      "解析错误被当成了「SSR 不可用」的结论 —— 门禁空转",
    ).toBe(false);
  });
});
