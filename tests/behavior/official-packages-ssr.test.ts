/**
 * 官方包的 SSR 侧契约（R25-A / issue #70）
 *
 * 这一组固定的是「Node/SSR 消费者 import 这两个包会发生什么」——正是 #71 / #73 / #74
 * 的 SSR 门禁要依据的事实。两条结论都不靠推断，靠**真的在一个无 DOM 的 Node 进程里 import**：
 *
 * 1. `@baidumap/jsapi-loader` 的 ESM 入口可以 import；`load()` 抛 `只能在浏览器环境使用`，
 *    `getStatus()` / `reset()` 无副作用。→ 默认 Provider 可以安全地进入 SSR 模块图，
 *    把「不能在没有浏览器的地方使用」推迟到调用期。
 * 2. `@baidumap/jsapi-ui-kit` 在无 DOM 时**import 即失败**：包内没有 `exports` 字段，
 *    Node 走 `main`（IIFE 产物），模块求值期就访问 `document`。→ UI Kit 只能等浏览器挂载后
 *    动态 import，绝不能出现在根入口或任何 SSR 可达的模块图里。
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

/** 在无 DOM 的 Node 子进程里跑一段 ESM 代码，返回 stdout（失败时附带 stderr 与退出码）。 */
function runInNode(source: string): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
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
  it("jsapi-loader：import 成功，load() 拒绝，getStatus/reset 无副作用", () => {
    const result = runInNode(`
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
    `);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.output.trim()) as Record<string, string | boolean>;
    expect(report.hasWindow).toBe(false);
    expect(report.status).toBe("notload");
    expect(report.statusAfterReset).toBe("notload");
    expect(String(report.load)).toContain("只能在浏览器环境使用");
  });

  it("jsapi-ui-kit：import 即失败（SSR 模块图里不得静态引入）", () => {
    const result = runInNode(`
      try {
        await import("@baidumap/jsapi-ui-kit");
        console.log("RESOLVED");
      } catch (error) {
        console.log(error.constructor.name + ": " + error.message);
      }
    `);
    expect(result.code).toBe(0);
    const output = result.output.trim();
    expect(output, "import 成功了 —— 上游改了入口形状，需重新核对 #73 的 SSR 策略").not.toBe(
      "RESOLVED",
    );
    // 具体文案取决于解析到哪个入口：CJS/IIFE 撞 document，ESM 撞 location。
    expect(output).toMatch(/ReferenceError: (document|location) is not defined/);
  });

  it("jsapi-ui-kit：即使绕过 main 直接拿 ESM 产物，无 DOM 时同样不可用", () => {
    const result = runInNode(`
      try {
        await import("@baidumap/jsapi-ui-kit/dist/jsapi-ui-kit.esm.js");
        console.log("RESOLVED");
      } catch (error) {
        console.log(error.constructor.name + ": " + error.message);
      }
    `);
    expect(result.code).toBe(0);
    const output = result.output.trim();
    expect(output, "ESM 产物在无 DOM 环境下竟然可加载，需重新核对").not.toBe("RESOLVED");
    // 必须是一条**运行时**错误：不然「解析不到模块 / 子路径被 exports 挡住」这类
    // 「没跑到」的失败也会被算成通过。
    expect(output).toMatch(/^(TypeError|ReferenceError|Error): /);
  });
});
