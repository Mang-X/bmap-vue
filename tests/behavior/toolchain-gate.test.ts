/**
 * pnpm 配置卫生门禁（issue #187 / #192）
 *
 * 判据内核在 `scripts/toolchain-boundary.mts`。这里只测纯判据，用合成输入给正反例——
 * 真实 lockfile / package.json 由驱动脚本读，单元层不碰。
 *
 * 三条判据各自对应一次**已发生的**故障（见内核文件头的表格），所以每条都必须有反例：
 * 一条判据若在真实缺陷存在时仍然绿，它比没有更糟。
 */
import { describe, expect, it } from "vitest";
import {
  checkLockfileOverrides,
  checkManifestPnpmField,
  checkPackageManagerDrift,
  parsePackageManagerVersion,
} from "../../scripts/toolchain-boundary.mts";

/** 一份没有生效 override 的 lockfile 片段（真实文件里那段的样子）。 */
const CLEAN_LOCK = "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      vue:\n        version: 3.5.42\n";

describe("#192 pnpm 配置卫生门禁", () => {
  describe("判 1：lockfile 里不得有生效的 override", () => {
    it("没有 overrides 块时放行", () => {
      expect(checkLockfileOverrides(CLEAN_LOCK)).toEqual([]);
    });

    it("顶层出现 overrides 块必须红（#187：那句 override 从未生效，而 lockfile 里也没有）", () => {
      // pnpm 会把**生效**的 override 写进 lockfile，因此这个块的存在就是直接证据。
      const issues = checkLockfileOverrides(`${CLEAN_LOCK}\noverrides:\n  vue-tsc: 3.3.11\n`);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("lockfile-has-overrides");
    });

    it("嵌套结构里的同名键不算（只认顶层键）", () => {
      // 否则某个包的 dependencies 下恰好有个叫 overrides 的东西就会误红。
      const lock = "importers:\n  .:\n    dependencies:\n      overrides:\n        version: 1.0.0\n";
      expect(checkLockfileOverrides(lock)).toEqual([]);
    });
  });

  describe("判 2：package.json 不得有 pnpm 字段", () => {
    it("没有该字段时放行", () => {
      expect(checkManifestPnpmField({ name: "x" })).toEqual([]);
    });

    it("有该字段必须红（pnpm 12 不再读取，三项设置全部空转）", () => {
      const issues = checkManifestPnpmField({ pnpm: { overrides: { "vue-tsc": "3.3.11" } } });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("manifest-has-pnpm-field");
      expect(issues[0]!.detail).toContain("pnpm-workspace.yaml");
    });

    it("字段存在但为空对象同样红（它在 package.json 里就是噪声）", () => {
      expect(checkManifestPnpmField({ pnpm: {} })).toHaveLength(1);
    });
  });

  describe("判 3：packageManager 声明 == 当前真正运行的 pnpm", () => {
    it("两者一致时放行", () => {
      expect(checkPackageManagerDrift("pnpm@12.0.0", "12.0.0")).toEqual([]);
    });

    it("运行的不是声明的那个版本必须红（评审 P2：声明管不住实际跑的）", () => {
      const issues = checkPackageManagerDrift("pnpm@12.0.0", "11.0.0");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("package-manager-drift");
      expect(issues[0]!.detail).toContain("11.0.0");
      expect(issues[0]!.detail).toContain("corepack");
    });

    it("这条判据防的是 corepack / action-setup 未生效时二者分叉", () => {
      // 刻意说明它**防不了**什么：声明与执行在多数情况下是绑定的——
      // corepack 与 `pnpm/action-setup@v6` 都从 `packageManager` 取版本，所以把声明改成
      // `pnpm@11.0.0` 会让实际执行的也变成 11.0.0，判据仍然绿（实测确认）。
      //
      // 它真正能抓的是**绑定失效**：corepack 被禁用、action-setup 被显式指定了别的版本、
      // 或本机全局 pnpm 抢在 corepack 之前被 PATH 命中——那时两者分叉而无人察觉。
      // 因此判据只承诺这一件事，不承诺「检测到声明被改」。
      expect(checkPackageManagerDrift("pnpm@12.0.0", "12.0.0")).toEqual([]);
    });

    it("fail-closed：读不到运行版本判红（「测不到」不等于「没问题」）", () => {
      const issues = checkPackageManagerDrift("pnpm@12.0.0", undefined);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.detail).toContain("fail-closed");
    });

    it("fail-closed：没有 packageManager 字段也判红", () => {
      const issues = checkPackageManagerDrift(undefined, "12.0.0");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.detail).toContain("packageManager");
    });

    it("声明格式解析不出版本号时判红（不猜）", () => {
      expect(checkPackageManagerDrift("12.0.0", "12.0.0")).toHaveLength(1);
      expect(checkPackageManagerDrift("pnpm@latest", "12.0.0")).toHaveLength(1);
    });
  });

  describe("packageManager 版本解析", () => {
    it("标准形态", () => {
      expect(parsePackageManagerVersion("pnpm@12.0.0")).toBe("12.0.0");
    });

    it("包名带 scope 时用 lastIndexOf 取对段（split('@')[1] 会取错）", () => {
      expect(parsePackageManagerVersion("@scope/pkg@1.2.3")).toBe("1.2.3");
    });

    it("没有版本号或格式不对时返回 undefined，不返回半截字符串", () => {
      expect(parsePackageManagerVersion("pnpm")).toBeUndefined();
      expect(parsePackageManagerVersion("pnpm@latest")).toBeUndefined();
      expect(parsePackageManagerVersion("pnpm@12.0")).toBeUndefined();
      expect(parsePackageManagerVersion("@12.0.0")).toBeUndefined();
    });
  });
});