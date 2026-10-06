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

    // ⚠️ 评审 P1：初版只取最后一个 `@` 之后的版本号，`npm@12.0.0` 与运行中的
    // `12.0.0` 判定相等 ⇒ **假绿**——`packageManager` 已经声明成 npm，门禁却报
    // 「pnpm 声明与执行一致」。这是本判据最危险的失效形态：它承诺的正是
    // 「声明与执行确实一致」，而这条路径下它连「声明的是不是 pnpm」都没看。
    it("声明成别的 manager（npm@12.0.0）必须红，不能在运行版本恰好相同时放行", () => {
      const issues = checkPackageManagerDrift("npm@12.0.0", "12.0.0");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("package-manager-drift");
      expect(issues[0]!.detail).toContain("npm@12.0.0");
    });

    // ⚠️ 评审 P1 的另一半：Corepack 推荐带完整性校验，初版正则 `^\d+\.\d+\.\d+$`
    // 把 `+sha512.<hex>` 整条判成「解析不出」⇒ **误红**。
    it("带 Corepack 完整性后缀（pnpm@12.0.0+sha512.<hex>）必须能提取出版本并放行", () => {
      expect(checkPackageManagerDrift("pnpm@12.0.0+sha512.abcdef0123", "12.0.0")).toEqual([]);
    });

    it("带完整性后缀但版本不同样判红（后缀不能把版本比较短路掉）", () => {
      expect(checkPackageManagerDrift("pnpm@11.0.0+sha512.abcdef0123", "12.0.0")).toHaveLength(1);
    });
  });

  describe("packageManager 版本解析", () => {
    it("标准形态", () => {
      expect(parsePackageManagerVersion("pnpm@12.0.0")).toBe("12.0.0");
    });

    // ⚠️ 这条用例的旧版断言 `@scope/pkg@1.2.3 → 1.2.3` 是**错的**（评审 P1）：
    // scoped 名字不是合法的 package manager，用「包名可能带 scope」来论证
    // `lastIndexOf("@")` 的必要性，代价是放过了 `npm@12.0.0` 这种真会发生的假绿。
    // 现在只认 `pnpm@<semver>`，其它 manager 一律 undefined。
    it("别的 manager 一律不认（这个字段只该出现 pnpm）", () => {
      expect(parsePackageManagerVersion("npm@12.0.0")).toBeUndefined();
      expect(parsePackageManagerVersion("yarn@1.2.3")).toBeUndefined();
      expect(parsePackageManagerVersion("@scope/pkg@1.2.3")).toBeUndefined();
    });

    it("接受 Corepack 的 +<algo>.<hex> 完整性后缀，仍取出纯版本号", () => {
      expect(parsePackageManagerVersion("pnpm@12.0.0+sha512.abcdef0123")).toBe("12.0.0");
      expect(parsePackageManagerVersion("pnpm@12.0.0+sha224.953c8233")).toBe("12.0.0");
    });

    it("没有版本号或格式不对时返回 undefined，不返回半截字符串", () => {
      expect(parsePackageManagerVersion("pnpm")).toBeUndefined();
      expect(parsePackageManagerVersion("pnpm@latest")).toBeUndefined();
      expect(parsePackageManagerVersion("pnpm@12.0")).toBeUndefined();
      expect(parsePackageManagerVersion("@12.0.0")).toBeUndefined();
      // 空后缀 / 不完整的完整性段都不认（`+` 后面必须有 `<algo>.<hex>`）
      expect(parsePackageManagerVersion("pnpm@12.0.0+")).toBeUndefined();
      expect(parsePackageManagerVersion("pnpm@12.0.0+sha512")).toBeUndefined();
    });
  });
});