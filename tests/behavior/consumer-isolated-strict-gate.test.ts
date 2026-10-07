/**
 * 仓库外隔离严格消费门禁的自测（issue #158 工作包 A）
 *
 * 这道门禁守的是「发布 tarball 在**真实消费方**环境里能被严格编译」。真实编译由
 * `pnpm verify:package` 在 CI 里跑（它要 `pnpm build:package` 出 `dist/` 再 pack，
 * 而 `dist/` 正是 `export-surface-freeze` / `core-surface` / `doc-props-gate` 等
 * **并行**读的对象 —— 本目录下 `dts-strict-gate.test.ts` 已经记着同一个坑）。
 *
 * 这里守的是判据本身没被改空。三件事：
 *
 * 1. **接线**：`verify:package` 真的调了隔离脚本，且把 tarball 作为显式输入传下去。
 *    「写了但没跑」是新增门禁最典型的失效方式，`check:dts-strict` 的自测里记着同一条。
 * 2. **隔离是真的**：临时目录里手写的 install 根清单**不得**出现 library 依赖 ——
 *    只要写了 `"@mangax/bmap-vue": "file:…"` 之类的条目，装出来的包就可能不是命令行
 *    给的那一个，「验的是哪一个包」立刻说不清。
 * 3. **两档都在，且判据支点没被改**：`bundler` 与 `node16` 必须都在名单里，且两份
 *    tsconfig 都是 `skipLibCheck: false` + `strict: true`。少一档 / 放宽 skipLibCheck
 *    都会让「严格消费」这件事不再成立，而**没有任何别的东西会红**。
 *
 * 判据读的是源码文本（与 `dts-strict-gate.test.ts` 同一手法）：这些文件的**内容**
 * 就是判据的定义。
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, parse } from "node:path";
import {
  ancestorEntries,
  assertNoAncestorNodeModules,
  assertOutsidePnpmWorkspace,
} from "../../scripts/consumer-isolation.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/consumer-isolated-strict.mts");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");
const STRICT_DIR = resolve(ROOT, "fixtures/consumer/strict");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("隔离严格消费：接线", () => {
  it("verify:package 调的是同一个实现，不在原文件里复刻安装 + tsc", () => {
    const source = read(VERIFY);
    expect(source, "verify-package.mts 没有调用隔离严格消费脚本").toContain(
      "consumer-isolated-strict.mts",
    );
    // 判据是「谁真正跑 tsc」：隔离项目里的 tsc 由隔离脚本启动。
    // verify-package 自己那份 `npx vue-tsc` 跑在 workspace 成员 fixture 里，是另一条判据，
    // 不能拿它冒充隔离验证。
    expect(source, "隔离脚本没有被当作独立进程调用").toMatch(
      /node --experimental-strip-types[^\n]*consumer-isolated-strict\.mts/,
    );
  });

  it("tarball 是**显式输入**，不是脚本自己去 .artifacts 里猜", () => {
    const source = read(SCRIPT);
    // 缺参数必须失败（而不是回落到「目录里最后一个 tgz」——那正是
    // `isOwnTarball` 的文档注释里记着的「验了旧包」失效模式）。
    expect(source, "隔离脚本没有要求显式传入 tarball").toMatch(
      /process\.argv\[2\][\s\S]{0,400}用法：/,
    );
    expect(source, "隔离脚本里出现了 .artifacts 的 tarball 目录扫描").not.toMatch(
      /readdirSync\([^)]*artifacts/,
    );
    // verify-package 侧必须把它传下去：脚本路径与 tarball 都要出现，且 tarball
    // 走的是 `JSON.stringify(tarball)`（路径里有空格时裸拼会裂成两个参数）。
    //
    // 判据刻意用**字面 token**而不是正则：定界符是 `}`，在正则里要写成 `\}`，
    // 而 JS 字符串里再写一层转义就多了一层「反斜杠 vs 字符」的对齐风险 ——
    // `dts-strict-gate.test.ts` 里那条恒绿的反漂移判据正是这么翻车的（#188 评审 P2）。
    const verifySource = read(VERIFY);
    expect(
      verifySource.includes("consumer-isolated-strict.mts'))} ${JSON.stringify(tarball)}"),
      "verify-package 调用隔离脚本时没有以 JSON.stringify(tarball) 传入选定的 tarball",
    ).toBe(true);
  });

  it("CI 的 package job 仍然只经 verify:package 这一个入口", () => {
    // 工作包 E 的判据：「CI 和本地同一入口，不复制另一套 shell runner」。
    // 这里只钉住**没有**在 workflow 里另起一份隔离安装 + tsc。
    const workflow = readWorkflow("quality.yml");
    const block = stepBlockContaining(workflow, "verify:package");
    expect(block.length, "CI 里找不到 verify:package 这一步").toBeGreaterThan(0);
    expect(workflow, "CI 里出现了消费脚本的第二处调用（应当只经 verify:package）").not.toContain(
      "consumer-isolated-strict.mts",
    );
  });
});

describe("隔离严格消费：隔离是真的", () => {
  it("临时项目的 install 根清单不写 library 依赖", () => {
    const source = read(SCRIPT);
    // 手写清单里只允许出现 vue 与 typescript；包本身只能来自命令行给的 tarball。
    const manifestBlock = /const manifest: InstallManifest = \{([\s\S]*?)\n {2}\};/.exec(source)?.[1];
    expect(manifestBlock, "读不到隔离项目的手写清单 —— 判据没有着力点").toBeTruthy();
    expect(manifestBlock!).not.toMatch(/@mangax\/bmap-vue/);
    expect(manifestBlock!).toContain("dependencies: { vue }");
    // 反向：tarball 必须真的出现在 npm install 的参数里。
    expect(source, "npm install 没有装命令行给的 tarball").toMatch(
      /run\("npm", \["install",[^\]]*tarball\]/,
    );
  });

  it("爬升路径与工作区两件事都判（隔离失效的两个方向）", () => {
    const source = read(SCRIPT);
    expect(source, "没有判「到磁盘根之间存在 node_modules」").toContain(
      "assertNoAncestorNodeModules",
    );
    expect(source, "没有判「临时项目位于 pnpm 工作区内」").toContain("assertOutsidePnpmWorkspace");
    // 两个判据都来自 boundary 模块（用例在下面按**行为**验它们，不是查源码文本）。
    expect(source, "隔离判据没有从 boundary 模块导入").toContain("./consumer-isolation.mts");
  });

  /**
   * 判据要按**行为**验，不是「源码里出现了某个名字」（#205 评审 P2）。
   *
   * 上一版 `assertNotWorkspaceMember()` 只查临时项目**自己**目录里的 marker，而
   * `pnpm-workspace.yaml` 基本只在 workspace 根（祖先）。于是「`TMPDIR=<repo>/.tmp`
   * 时新目录仍在 workspace 里」这一形态会被放过，而断言仍然报通过 —— 文本存在性检查
   * 对这个实现错误是全绿的。下面在**真实合成目录树**上跑反例。
   */
  it("workspace marker 在**祖先**目录时必须判红（按行为验，不是查文本）", () => {
    const base = mkdtempSync(resolve(tmpdir(), "bmap-vue-isolation-probe-"));
    try {
      writeFileSync(resolve(base, "pnpm-workspace.yaml"), "packages: []\n");
      const nested = resolve(base, "nested", "deeper");
      mkdirSync(nested, { recursive: true });
      expect(
        () => assertOutsidePnpmWorkspace(nested),
        "workspace 根在祖先时没有判红 —— 这正是 #205 评审 P2 指出的形态",
      ).toThrow(/workspace/);
      // 对照：同一棵树的 workspace 根**自己**也应判红（含 `dir` 本身）。
      expect(() => assertOutsidePnpmWorkspace(base)).toThrow(/workspace/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("祖先里有 node_modules 时必须判红，且 `dir` 自己的不算（按行为验）", () => {
    const base = mkdtempSync(resolve(tmpdir(), "bmap-vue-isolation-probe-"));
    try {
      const project = resolve(base, "project");
      mkdirSync(resolve(base, "node_modules"), { recursive: true });
      mkdirSync(resolve(project, "node_modules"), { recursive: true });
      expect(
        () => assertNoAncestorNodeModules(project),
        "祖先 `node_modules` 没有判红 —— 向上查找会补足包缺失",
      ).toThrow(/node_modules/);
      // `dir` 自己的 `node_modules` 是**我们装出来的那棵树**，不该判红。
      const clean = mkdtempSync(resolve(tmpdir(), "bmap-vue-isolation-probe-"));
      try {
        mkdirSync(resolve(clean, "node_modules"), { recursive: true });
        expect(() => assertNoAncestorNodeModules(clean)).not.toThrow();
      } finally {
        rmSync(clean, { recursive: true, force: true });
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("干净目录两件事都不判红（避免判据恒假）", () => {
    const base = mkdtempSync(resolve(tmpdir(), "bmap-vue-isolation-probe-"));
    try {
      const nested = resolve(base, "a", "b");
      mkdirSync(nested, { recursive: true });
      expect(() => assertOutsidePnpmWorkspace(nested)).not.toThrow();
      expect(() => assertNoAncestorNodeModules(nested)).not.toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  /**
   * **磁盘根自己**也在判据范围内（#205 第三次评审 P2）。
   *
   * 遍历在拼入第一个 segment **之后**才检查，所以旧实现覆盖不到 `root/marker`：
   * `/node_modules`（Windows 的 `C:\node_modules`）或盘符根的 workspace marker 会被
   * 当成「路径干净」，而向上模块解析恰恰会查到它。
   *
   * 这一条**不能**用真实文件系统造（没人该往 `/` 写东西），所以走 `IsolationFs` 注入：
   * fake fs 只对「磁盘根 + marker」这一条路径返回 true，其余全 false。判据必须因此抛错。
   */
  it("磁盘根自己的 node_modules / workspace marker 必须判红（注入 fs，不碰真实根）", () => {
    const dir = resolve(tmpdir(), "bmap-vue-root-probe", "project");
    const root = parse(dir).root;
    const rootModules = resolve(root, "node_modules");
    const rootWorkspace = resolve(root, "pnpm-workspace.yaml");

    // 正证：根节点命中时，遍历结果里**必须**有它（直接钉住「含磁盘根」这件事）。
    expect(ancestorEntries(dir, "node_modules", { exists: (p) => p === rootModules })).toEqual([
      rootModules,
    ]);

    expect(
      () => assertNoAncestorNodeModules(dir, { exists: (p) => p === rootModules }),
      "磁盘根的 `node_modules` 被跳过了 —— 向上解析会命中它",
    ).toThrow(/node_modules/);

    expect(
      () => assertOutsidePnpmWorkspace(dir, { exists: (p) => p === rootWorkspace }),
      "磁盘根的 workspace marker 被跳过了 —— 那时项目就在 workspace 内",
    ).toThrow(/workspace/);

    // 反证：同样只覆盖根节点路径的 fake fs，在「一切都不存在」时必须放行（判据不能恒红）。
    const nothing = { exists: () => false };
    expect(() => assertNoAncestorNodeModules(dir, nothing)).not.toThrow();
    expect(() => assertOutsidePnpmWorkspace(dir, nothing)).not.toThrow();
  });

  /**
   * `pnpm-lock.yaml` **不单独**作为「位于 workspace 内」的判据。
   *
   * 一个普通（非 workspace）pnpm 项目同样有 lockfile，把它并进 workspace 判据会在
   * 「临时目录恰好在某个普通 pnpm 项目下」时**假红**。真正该管的那种情况由
   * `assertNoAncestorNodeModules` 覆盖（向上查找会命中那个项目的 `node_modules`）。
   * 这条把取舍钉住：将来有人「顺手」把 lockfile 加进 marker 列表，会红。
   */
  it("只有 pnpm-lock.yaml 的祖先不算 workspace（避免假红）", () => {
    const base = mkdtempSync(resolve(tmpdir(), "bmap-vue-isolation-probe-"));
    try {
      writeFileSync(resolve(base, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const nested = resolve(base, "nested");
      mkdirSync(nested, { recursive: true });
      expect(
        () => assertOutsidePnpmWorkspace(nested),
        "普通 pnpm 项目的 lockfile 被当成了 workspace 根 —— 这是假红",
      ).not.toThrow();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("装出来的树必须能被证明来自 tarball（解析位置 + 无官方类型包）", () => {
    const source = read(SCRIPT);
    expect(source, "没有断言包解析在本项目 node_modules 内").toMatch(
      /解析到了本项目之外/,
    );
    // 官方类型包在隔离项目里出现 = 公共声明泄漏 `BMap.*` 会被悄悄接住。
    expect(source, "没有断言 @baidumap/jsapi-v4-types 缺席").toContain(
      "@baidumap/jsapi-v4-types",
    );
    // symlink（macOS /tmp → /private/tmp）会让上面那条**假红**：假红与假绿一样
    // 让门禁失去意义，所以比较必须走真实路径。
    expect(source, "解析位置比较没有做 realpath 规范化").toContain("realpathSync");
  });

  it("npm 缓存不落在仓库外（EPERM 会让门禁以与改动无关的原因失败）", () => {
    const source = read(SCRIPT);
    expect(source, "没有把 npm 缓存放进仓库内").toContain("npm_config_cache");
  });
});

describe("隔离严格消费：两档编译与判据支点", () => {
  it("bundler 与 node16 两档都在名单里", () => {
    const source = read(SCRIPT);
    const targets = /const TARGETS = \[([\s\S]*?)\] as const;/.exec(source)?.[1];
    expect(targets, "读不到 TARGETS —— 判据没有着力点").toBeTruthy();
    expect(targets!, '缺少 bundler 档').toContain('"tsconfig.json"');
    expect(targets!, '缺少 node16 档').toContain('"tsconfig.node16.json"');
    // 非目标：不增加未承诺的 CJS / Node10 支持。
    expect(targets!, "出现了本库未承诺的 CJS / Node10 档").not.toMatch(/CommonJs|Node10/i);
  });

  it("两档都要求 skipLibCheck: false —— 改成 true 就不再是严格消费", () => {
    // 与 `check-dts-strict.mts` 同一条判据，此处按**源码支点**再钉一次：
    // 隔离脚本必须在运行时读到并确认这两个值，而不是「相信配置文件」。
    const source = read(SCRIPT);
    expect(source, "隔离脚本没有在运行时确认 skipLibCheck").toMatch(
      /options\.skipLibCheck !== false/,
    );
    expect(source, "隔离脚本没有在运行时确认 strict").toMatch(/options\.strict !== true/);
  });

  it.each(["tsconfig.json", "tsconfig.node16.json"])(
    "fixtures/consumer/strict/%s 是严格配置",
    (file) => {
      const path = resolve(STRICT_DIR, file);
      expect(existsSync(path), `缺少判据输入：${path}`).toBe(true);
      const options = (
        JSON.parse(read(path)) as { compilerOptions: Record<string, unknown> }
      ).compilerOptions;
      expect(options.skipLibCheck, `${file} 关掉了 skipLibCheck 就没有严格消费`).toBe(false);
      expect(options.strict, `${file} 必须开 strict`).toBe(true);
      expect(options.noEmit, `${file} 不应产出文件`).toBe(true);
    },
  );

  it("node16 档真的是 node16（两份配置只在模块系统上不同）", () => {
    const bundler = JSON.parse(read(resolve(STRICT_DIR, "tsconfig.json"))) as {
      compilerOptions: Record<string, unknown>;
    };
    const node16 = JSON.parse(read(resolve(STRICT_DIR, "tsconfig.node16.json"))) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(bundler.compilerOptions.moduleResolution).toBe("bundler");
    expect(node16.compilerOptions.moduleResolution).toBe("Node16");
    expect(node16.compilerOptions.module).toBe("Node16");
    // 除模块系统与解释性字段外，其余选项必须一致 —— 否则两档比的就不是同一件事。
    const strip = (options: Record<string, unknown>): Record<string, unknown> => {
      const { module, moduleResolution, ...rest } = options;
      void module;
      void moduleResolution;
      return rest;
    };
    expect(strip(node16.compilerOptions)).toEqual(strip(bundler.compilerOptions));
  });

  it("两档编译的是同一份探针（不是各自一份）", () => {
    for (const file of ["tsconfig.json", "tsconfig.node16.json"]) {
      const raw = JSON.parse(read(resolve(STRICT_DIR, file))) as { include?: string[] };
      expect(raw.include, `${file} 的输入不是共享的那份探针`).toEqual(["probe.ts"]);
    }
  });
});
