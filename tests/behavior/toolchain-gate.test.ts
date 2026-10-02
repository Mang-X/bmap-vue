/**
 * 声明工具链门禁（issue #187）
 *
 * 判据内核在 `scripts/toolchain-boundary.mts`。这里只测纯判据，用合成 lockfile / 安装结果给出
 * 正反例 —— 真实 lockfile 与 `node_modules` 由 `scripts/check-toolchain.mts` 在驱动里读，
 * 单元层不碰（与 `package-shape-gate.test.ts` 对 attw 的同一处置）。
 *
 * 这道门禁要挡的是**一句失效的版本声称**：本票的起因是 `pnpm.overrides` 写在
 * `package.json#pnpm` 里，pnpm 12 早就不读那个字段，于是「看起来锁住了」而实际从未生效。
 * 因此判据刻意落到**实际解析结果**（lockfile + 磁盘），而不是声明面上的 `^` / `~`。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  KNOWN_PEER_MISMATCHES,
  TOOLCHAIN_PINS,
  auditPins,
  checkInstalled,
  checkPeerMismatches,
  checkDeclaredSpecifier,
  checkPin,
  checkRuntimeVersion,
  declaredVersion,
  normalizeResolvedVersion,
  parseImporterBlock,
  type ToolchainPin,
} from "../../scripts/toolchain-boundary.mts";

/** 一条满足登记的 lockfile 条目，用作正例的起点。 */
const OK_ENTRY = { specifier: "^2.2.0", version: "2.2.12(typescript@5.9.3)" };
const SAMPLE_PIN: ToolchainPin = {
  importer: "packages/bmap-vue",
  name: "vue-tsc",
  version: "2.2.12",
  why: "发布包类型门禁实际执行的版本",
};

describe("#187 声明工具链门禁", () => {
  describe("基线表本身的自洽性", () => {
    it("基线表刻意非空，且每条都带 x.y.z 版本与 why", () => {
      // 空表会让「一切正常」与「把基线删光」长得一模一样。
      expect(TOOLCHAIN_PINS.length).toBeGreaterThan(0);
      expect(auditPins()).toEqual([]);
    });

    it("fail-closed：表被清空必须红，不能当成全绿", () => {
      const issues = auditPins([]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("baseline-empty");
      expect(issues[0]!.detail).toContain("为空");
    });

    it("版本不是 x.y.z 必须红（否则比较口径本身没有意义）", () => {
      const issues = auditPins([{ ...SAMPLE_PIN, version: "2.2" }]);
      expect(issues.map((i) => i.kind)).toContain("baseline-malformed");
    });

    it("缺 why 必须红（失败时没人看懂为什么是这个版本）", () => {
      const issues = auditPins([{ ...SAMPLE_PIN, why: "" }]);
      expect(issues.map((i) => i.kind)).toContain("baseline-malformed");
      expect(issues.map((i) => i.detail).join()).toContain("缺 why");
    });

    it("同一条登记重复必须红（基线有歧义时判据没有唯一解）", () => {
      const issues = auditPins([SAMPLE_PIN, SAMPLE_PIN]);
      expect(issues.map((i) => i.kind)).toContain("baseline-duplicate");
      expect(issues.map((i) => i.detail).join()).toContain("登记了两次");
    });

    it("基线覆盖了本票的两处关键事实：包与 docs 是不同 major 的 vue-tsc", () => {
      // 这正是被删除的那句失效 override 谎报的东西（它声称全仓库都是 3.3.11）。
      const pkg = TOOLCHAIN_PINS.find((p) => p.importer === "packages/bmap-vue" && p.name === "vue-tsc");
      const docs = TOOLCHAIN_PINS.find((p) => p.importer === "docs" && p.name === "vue-tsc");
      expect(pkg!.version).toBe("2.2.12");
      expect(docs!.version).toBe("3.3.11");
      expect(pkg!.version).not.toBe(docs!.version);
    });

    it("声明产出的真实产出者 @vue/language-core 在基线里", () => {
      // unplugin-dts 直接 import 它，少了这条登记就等于没钉住声明产出的关键一环。
      const pin = TOOLCHAIN_PINS.find((p) => p.name === "@vue/language-core");
      expect(pin).toBeDefined();
      expect(pin!.importer).toBe("packages/bmap-vue");
    });
  });

  describe("peer 后缀归一", () => {
    it("剥掉 pnpm 编进版本键的 peer 解析后缀", () => {
      expect(normalizeResolvedVersion("2.2.12(typescript@5.9.3)")).toBe("2.2.12");
      expect(normalizeResolvedVersion("5.1.0(@microsoft/api-extractor@7.59.0(@types/node@26.4.1))")).toBe(
        "5.1.0",
      );
    });

    it("裸版本原样返回", () => {
      expect(normalizeResolvedVersion("5.9.3")).toBe("5.9.3");
    });
  });

  describe("声明 → lockfile 的核对", () => {
    it("实际解析版本与基线一致时放行", () => {
      expect(checkPin(SAMPLE_PIN, OK_ENTRY)).toEqual([]);
    });

    it("解析版本漂移必须红（本票要挡的那类「看起来锁住了」）", () => {
      // 失效 override 的真实形态：lockfile 里根本没有 3.3.11 给包用。
      const issues = checkPin(SAMPLE_PIN, { specifier: "^3.3.11", version: "3.3.11(typescript@5.9.3)" });
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("resolution-drift");
      expect(issues[0]!.detail).toContain("2.2.12");
    });

    it("fail-closed：importer / 条目缺失判失败，不当作通过", () => {
      const issues = checkPin(SAMPLE_PIN, undefined);
      expect(issues.map((i) => i.kind)).toEqual(["importer-missing"]);
      expect(issues[0]!.detail).toContain("fail-closed");
    });

    it("fail-closed：条目在但 version 读不到也判失败", () => {
      const issues = checkPin(SAMPLE_PIN, { specifier: "^2.2.0" });
      expect(issues.map((i) => i.kind)).toContain("version-unreadable");
    });

    it("specifier 缺失判失败", () => {
      const issues = checkPin(SAMPLE_PIN, { version: "2.2.12(typescript@5.9.3)" });
      expect(issues.map((i) => i.kind)).toContain("specifier-unpinned");
    });

    it("latest / * 一律红：每天装到的都可能不是同一个", () => {
      for (const specifier of ["latest", "*"]) {
        const issues = checkPin(SAMPLE_PIN, { specifier, version: "2.2.12(typescript@5.9.3)" });
        expect(issues.map((i) => i.kind), specifier).toContain("specifier-unpinned");
      }
    });

    it("^ / ~ 不判红：它们由 lockfile 钉住，漂移会走 resolution-drift 那一路", () => {
      // 刻意区分两种漂移：specifier 是宽松范围（合法，但解析结果由 lockfile 定），
      // 与解析结果真的变了（要红）。把 ^ 也判红会让判据退化成「禁止用范围」。
      expect(checkPin(SAMPLE_PIN, { specifier: "~2.2.0", version: "2.2.12(typescript@5.9.3)" })).toEqual([]);
    });
  });

  describe("lockfile → 磁盘的核对", () => {
    it("磁盘版本与基线一致时放行", () => {
      expect(checkInstalled(SAMPLE_PIN, "2.2.12")).toEqual([]);
    });

    it("磁盘版本对不上必须红（lockfile 说的是 A、实际跑的是 B）", () => {
      const issues = checkInstalled(SAMPLE_PIN, "2.2.10");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("disk-mismatch");
      expect(issues[0]!.detail).toContain("2.2.10");
    });

    it("fail-closed：磁盘上找不到包判失败", () => {
      const issues = checkInstalled(SAMPLE_PIN, undefined);
      expect(issues[0]!.kind).toBe("disk-mismatch");
      expect(issues[0]!.detail).toContain("pnpm install");
    });
  });

  describe("peer 不匹配的登记", () => {
    it("登记表刻意非空，且每条都带 why 与追踪票号", () => {
      // 空表会让「不匹配消失了」与「没检查」无法区分。
      expect(KNOWN_PEER_MISMATCHES.length).toBeGreaterThan(0);
      for (const m of KNOWN_PEER_MISMATCHES) {
        expect(m.why.length, m.name).toBeGreaterThan(10);
        expect(m.tracking, m.name).toMatch(/^#\d+$/);
        // 结构化字段：例外基于哪个实装版本成立。靠 why 里的散文 `includes` 判版本
        // 实测会漏（why 里该版本号出现两次，改一处仍为真），所以它是独立字段。
        expect(m.observedVersion, m.name).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });

    it("登记内的不匹配放行", () => {
      expect(checkPeerMismatches(["@vue/language-core"])).toEqual([]);
    });

    it("没登记的必须红（上游新增一处不匹配时不能静默）", () => {
      const issues = checkPeerMismatches(["@some/new-peer"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("unexpected-peer-mismatch");
    });
  });

  describe("声明面 → lockfile 的一致性", () => {
    // 这一层不能省：lockfile 里的 specifier 是 pnpm **解析所依据**的那个，
    // package.json 里的是人手写的那份。只看 lockfile 的话，「改了 package.json 但没
    // 重新 install」不会变红——而那正是 #187 的起因（一句声称与实际脱节）。
    it("两者一致时放行", () => {
      expect(checkDeclaredSpecifier(SAMPLE_PIN, "^2.2.0", "^2.2.0")).toEqual([]);
    });

    it("manifest 与 lockfile 脱节必须红", () => {
      const issues = checkDeclaredSpecifier(SAMPLE_PIN, "^3.3.11", "^2.2.0");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("specifier-unpinned");
      expect(issues[0]!.detail).toContain("已脱节");
    });

    it("package.json 里没有该包但 lockfile 里有：判失败而不是跳过", () => {
      const issues = checkDeclaredSpecifier(SAMPLE_PIN, "—", "^2.2.0");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.detail).toContain("已脱节");
    });

    it("latest / * 必须红", () => {
      for (const declared of ["latest", "*"]) {
        expect(
          checkDeclaredSpecifier(SAMPLE_PIN, declared, declared).map((i) => i.kind),
          declared,
        ).toContain("specifier-unpinned");
      }
    });

    it("pnpm 由 packageManager 钉住，但这一层**照样判**（PR 评审 #191 的 P2）", () => {
      const pnpmPin = TOOLCHAIN_PINS.find((p) => p.name === "pnpm")!;
      expect(pnpmPin.which).toBe("packageManager");
      // 第一版在这里 `return []`，于是声明层空转、却仍然报「三方一致」——
      // 输出是 `声明 — / 磁盘 n/a`。现在 packageManager 读不出来必须判红。
      const issues = checkDeclaredSpecifier(pnpmPin, "—", undefined);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.detail).toContain("已脱节");
    });

    it("lockfile 读不到 specifier 时不判红（那一层由 checkPin 的 fail-closed 负责）", () => {
      // 避免同一缺陷被两条判据重复报告。
      expect(checkDeclaredSpecifier(SAMPLE_PIN, "^2.2.0", undefined)).toEqual([]);
    });
  });

  describe("pnpm 自身：packageManager 声明与真正运行的版本（PR 评审 #191 的 P2）", () => {
    it("declaredVersion 能从 packageManager 字段解析出版本", () => {
      expect(declaredVersion({ packageManager: "pnpm@12.0.0" }, "pnpm")).toBe("12.0.0");
      // 用 lastIndexOf：名字本身可能带 @（scope），split("@")[1] 会取错段。
      expect(declaredVersion({ packageManager: "@scope/pkg@1.2.3" }, "@scope/pkg")).toBe("1.2.3");
    });

    it("packageManager 缺失或格式不对时返回 undefined（不猜）", () => {
      expect(declaredVersion({}, "pnpm")).toBeUndefined();
      // 没有 `pnpm@` 前缀（只有版本号）→ 不猜它说的是 pnpm。
      expect(declaredVersion({ packageManager: "12.0.0" }, "pnpm")).toBeUndefined();
      // packageManager 说的是别的包 → 与所问的 pnpm 无关。
      expect(declaredVersion({ packageManager: "npm@10.0.0" }, "pnpm")).toBeUndefined();
    });

    const PNPM_PIN: ToolchainPin = {
      importer: ".",
      name: "pnpm",
      version: "12.0.0",
      why: "包管理器本身",
      which: "packageManager",
    };

    it("运行时版本与基线一致时放行", () => {
      expect(checkRuntimeVersion(PNPM_PIN, "12.0.0")).toEqual([]);
    });

    it("运行时 pnpm 与基线不符必须红（lockfile 管不住实际跑的那个）", () => {
      // 这正是「声明/记录的是 A，实际生效的是 B」——#187 的原始命题。
      const issues = checkRuntimeVersion(PNPM_PIN, "11.0.0");
      expect(issues).toHaveLength(1);
      expect(issues[0]!.kind).toBe("disk-mismatch");
      expect(issues[0]!.detail).toContain("11.0.0");
      expect(issues[0]!.detail).toContain("action-setup");
    });

    it("读不到运行时版本必须红（fail-closed：「测不到」不等于「没问题」）", () => {
      const issues = checkRuntimeVersion(PNPM_PIN, undefined);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.detail).toContain("fail-closed");
    });
  });

  describe("声明面读取", () => {
    it("devDependencies 优先于 dependencies，缺省返回 undefined", () => {
      expect(declaredVersion({ devDependencies: { vue: "^3.5.0" } }, "vue")).toBe("^3.5.0");
      expect(
        declaredVersion({ dependencies: { vue: "3.5.42" }, devDependencies: { vue: "^3.5.0" } }, "vue"),
      ).toBe("^3.5.0");
      expect(declaredVersion({}, "vue")).toBeUndefined();
    });
  });

  describe("lockfile 解析器", () => {
    /**
     * 一份**最小** lockfile 文本，刻意复刻本仓库真实 lockfile 的两个坑：
     *
     * 1. 顶部有一个先于工作区 `importers:` 的顶层 `importers:`（第 2 行），服务于
     *    `packageManagerDependencies`（下面挂着 pnpm 自己的 `@pnpm/exe.*`），它下面**也**
     *    有一个 `  .:` 键——但那个「根 importer」只含 configDependencies / pnpm 自依赖，
     *    **没有** dependencies / devDependencies。
     * 2. 工作区真正的 `importers:` 在后面。
     *
     * 解析器连踩三次（扫进假段 → 锚定第一个 `importers:` → 段边界没认顶层键）才读对，
     * 所以这一组用例是它的回归网：**读不出**时返回 undefined，由 checkPin 按 fail-closed 判红。
     */
    const LOCK_WITH_PNPM_SELF_DEPS = [
      "lockfileVersion: '9.0'",
      "",
      "importers:",
      "",
      "  .:",
      "    configDependencies: {}",
      "    packageManagerDependencies:",
      "      pnpm:",
      "        specifier: 12.0.0",
      "        version: 12.0.0",
      "",
      "packages:",
      "",
      "  '@pnpm/exe.darwin-arm64@12.0.0':",
      "    resolution: {integrity: sha512-fake}",
      "",
      "importers:",
      "",
      "  .:",
      "    dependencies:",
      "      mitt:",
      "        specifier: ^3.0.0",
      "        version: 3.0.1",
      "    devDependencies:",
      "      vue-tsc:",
      "        specifier: ^2.2.0",
      "        version: 2.2.12(typescript@5.9.3)",
      "      '@microsoft/api-extractor':",
      "        specifier: 7.59.0",
      "        version: 7.59.0(@types/node@26.4.1)",
      "",
      "  packages/bmap-vue:",
      "    devDependencies:",
      "      '@vue/language-core':",
      "        specifier: ^2.2.0",
      "        version: 2.2.12(typescript@5.9.3)",
      "",
      "packages:",
      "  (empty)",
      "",
    ].join("\n");

    it("锚定工作区的 importers，而不是 pnpm 自身的那个", () => {
      const entry = parseImporterBlock(LOCK_WITH_PNPM_SELF_DEPS, ".", "vue-tsc");
      expect(entry).toBeDefined();
      expect(entry!.specifier).toBe("^2.2.0");
      expect(entry!.version).toBe("2.2.12(typescript@5.9.3)");
    });

    it("带引号的 scope 包名能读到（`'@vue/language-core':`）", () => {
      const entry = parseImporterBlock(LOCK_WITH_PNPM_SELF_DEPS, "packages/bmap-vue", "@vue/language-core");
      expect(entry?.specifier).toBe("^2.2.0");
      expect(entry?.version).toBe("2.2.12(typescript@5.9.3)");
    });

    it("段边界认下一个 importer：不会把 packages/bmap-vue 的条目读成根的", () => {
      // 根段里没有 language-core；若边界没认下一个 2 空格 importer 就会误命中。
      expect(parseImporterBlock(LOCK_WITH_PNPM_SELF_DEPS, ".", "@vue/language-core")).toBeUndefined();
    });

    it("pnpm 自身的 @pnpm/exe.* 不会被误读成工作区依赖", () => {
      expect(parseImporterBlock(LOCK_WITH_PNPM_SELF_DEPS, ".", "@pnpm/exe.darwin-arm64")).toBeUndefined();
    });

    it("importer 不存在时返回 undefined（由 checkPin fail-closed 判红，不静默放行）", () => {
      expect(parseImporterBlock(LOCK_WITH_PNPM_SELF_DEPS, "packages/nope", "vue-tsc")).toBeUndefined();
    });

    it("importer 存在但没有该依赖时返回 undefined", () => {
      expect(parseImporterBlock(LOCK_WITH_PNPM_SELF_DEPS, ".", "not-installed")).toBeUndefined();
    });

    it("锁文件里没有 importers 时返回 undefined", () => {
      expect(parseImporterBlock("lockfileVersion: '9.0'\n", ".", "vue-tsc")).toBeUndefined();
    });

    it("对**本仓库真实**的 lockfile，根与包级都读得出来（防止只在合成样本上绿）", () => {
      const realLock = readFileSync(resolve(import.meta.dirname, "../../pnpm-lock.yaml"), "utf8");
      expect(parseImporterBlock(realLock, ".", "vue-tsc")?.version).toContain("2.2.12");
      expect(parseImporterBlock(realLock, "packages/bmap-vue", "vue-tsc")?.version).toContain("2.2.12");
      expect(parseImporterBlock(realLock, "docs", "vue-tsc")?.version).toContain("3.3.11");
      expect(parseImporterBlock(realLock, "packages/bmap-vue", "@vue/language-core")?.version).toContain(
        "2.2.12",
      );
    });
  });
});