/**
 * pnpm 配置卫生的判定内核（issue #187 / #192）
 *
 * 单独成文件是为了能被用例 import 而不触发真实 I/O（`check-toolchain.mts` 顶层就跑 `main()`）。
 *
 * ## 这个文件曾经有 600 行，现在只有三条判据——为什么
 *
 * 初版（#187）在这里建了一整套「声明 → lockfile → 磁盘」三方对照：11 条版本基线、
 * 语义化的失败码体系、一个手写的 lockfile 解析器（踩了三个坑才写对）。
 * 它守护的风险是「有人悄悄升级了 vue-tsc」——而那个风险由**别的**东西挡着：
 * dependabot 对 vue-tsc / typescript / vue 的 major 是忽略的，lockfile 入库，
 * CI 走 `--frozen-lockfile`，而任何升级都会在 PR 的 lockfile diff 里露出来。
 *
 * 代价却是实的：1276 行里 391 行是中文注释，其中大量在复述 #187 的 ADR 已经写过的
 * 决策史。两份事实源必然漂移，而 ADR 是**有意冻结**的那份（见 #192 的判据：
 * 「ADR 记录为什么，代码注释记录这是什么」）。
 *
 * 更要命的是：这道门禁的初版**自己假绿过**——`pnpm` 那三层里有两层被作者自己
 * `return []` 短路掉，却仍输出「三方一致」，靠人工评审才发现。一道需要评审才
 * 发现自己没在看的检查，代价与它防的风险不成比例。
 *
 * 因此只留下**三条在真实世界被违反过**的判据，每条都对应一次已发生的缺陷：
 *
 * | 判据 | 它挡住的那次真实故障 |
 * | --- | --- |
 * | lockfile 里不得有 `overrides:` 块 | #187：那句 override 从写下起就没生效过，而 lockfile 里根本没有对应记录 |
 * | `package.json` 不得有 `pnpm` 字段 | #187：pnpm 12 不再读取它，三项设置全部空转 |
 * | `packageManager` 声明 == 当前运行的 pnpm | #187 评审 P2：声明「应该用哪个」，管不住 runner 上「实际跑哪个」 |
 *
 * **版本基线表（vue-tsc / language-core / …）刻意不做成门禁**，事实记在
 * ADR `2026-10-02-pnpm-config-migration-and-declaration-toolchain`。
 */

/** 一条判据失败。`kind` 必须与它指向的缺陷同义——它决定维护者第一眼去查哪里。 */
export interface HygieneIssue {
  readonly kind: "lockfile-has-overrides" | "manifest-has-pnpm-field" | "package-manager-drift";
  readonly detail: string;
}

/**
 * 判 1：lockfile 里不得有 `overrides:` 块。
 *
 * pnpm 会把**生效**的 override 写进 lockfile。因此这个块的存在与否就是「有没有 override
 * 真的在生效」的直接证据。#187 之前它不在，于是那句「vue-tsc 锁在 3.3.11」是空的——
 * 而仓库里没有任何东西能发现，因为大家读的是 `package.json` 而不是 lockfile。
 *
 * 判据刻意**不解析** YAML：要的只是「这个键在不在」，一个正则足够。为此引入一个解析器
 * （初版那个手写解析器踩了三个坑：pnpm 自身的 `importers` 段、段边界、够不到深层包）
 * 是本末倒置。
 */
export function checkLockfileOverrides(lockText: string): HygieneIssue[] {
  // 只认顶层键（行首无缩进）：嵌套结构里出现同名键不算「生效的 override」。
  if (/^overrides:/m.test(lockText)) {
    return [
      {
        kind: "lockfile-has-overrides",
        detail:
          "pnpm-lock.yaml 顶层出现 `overrides:` 块：说明有 override 正在生效。" +
          "请确认它是有意为之并已登记在 ADR —— 本仓的判据是**不依赖 override** 固定版本" +
          "（#187：写在 package.json#pnpm 里的那份从未生效，却看起来像一道版本锁）",
      },
    ];
  }
  return [];
}

/**
 * 判 2：根 `package.json` 不得有 `pnpm` 字段。
 *
 * pnpm 12 不再读取该字段。写在那里不会报错，只会让每次干净安装打一行
 * `[WARN] The "pnpm" field in package.json is no longer read by pnpm`——
 * **配置看起来生效了，实际没有**。
 */
export function checkManifestPnpmField(manifest: Record<string, unknown>): HygieneIssue[] {
  if (manifest.pnpm === undefined) return [];
  return [
    {
      kind: "manifest-has-pnpm-field",
      detail:
        "package.json 仍有 `pnpm` 字段：pnpm 12 不再读取它，写在这里的设置（peerDependencyRules / " +
        "onlyBuiltDependencies / overrides）全部空转。pnpm 设置应写进 pnpm-workspace.yaml" +
        "（见 ADR 2026-10-02）",
    },
  ];
}

/**
 * 判 3：`packageManager` 声明的 pnpm 版本必须等于当前真正运行的那个。
 *
 * 这一层的存在理由不是形式：`packageManager` 与 lockfile 都只记录「**应该用**用哪个」，
 * 真正跑的那个取决于 corepack 与 CI 的 `pnpm/action-setup`——**不写进任何文件**。
 * 两者一旦分叉，本地与 CI 就在不同的 pnpm 上跑，而 lockfile 完全看不出来。
 * #187 的门禁初版正是漏了这一层（评审 P2），且漏得毫无声响。
 *
 * ⚠️ **它防不了什么（实测得出，不要误读它的覆盖面）**：声明与执行通常是**绑定**的——
 * corepack 与 `pnpm/action-setup@v6` 都从 `packageManager` 取版本，所以把声明改成
 * `pnpm@11.0.0` 会让实际执行的也变成 11.0.0，本判据仍然绿。
 *
 * 它真正能抓的是**绑定失效**：corepack 被禁用、`action-setup` 被显式指定了别的版本、
 * 或本机全局 pnpm 抢在 corepack 之前被 PATH 命中——那时两者分叉而无人察觉。
 * 也就是说，它承诺的是「声明与执行确实一致」，不是「声明被改动过」。
 */
export function checkPackageManagerDrift(
  declared: string | undefined,
  running: string | undefined,
): HygieneIssue[] {
  if (declared === undefined) {
    return [
      {
        kind: "package-manager-drift",
        detail: "package.json 没有 `packageManager` 字段：无法证明实际运行的 pnpm 是有意选定的那个",
      },
    ];
  }

  if (running === undefined) {
    // fail-closed：「测不到」不等于「没问题」。
    return [
      {
        kind: "package-manager-drift",
        detail:
          "读不到当前运行的 pnpm 版本（`pnpm --version` 执行失败）：无法核对声明与实际是否一致（fail-closed）",
      },
    ];
  }

  const declaredVersion = parsePackageManagerVersion(declared);
  if (declaredVersion === undefined) {
    return [
      {
        kind: "package-manager-drift",
        detail:
          `无法从 packageManager "${declared}" 解析出 pnpm 版本号：` +
          "合法形态是 `pnpm@<major>.<minor>.<patch>`，可带 Corepack 的 `+<algo>.<hex>` 完整性后缀。" +
          "⚠️ 声明成 npm / yarn 等其它 manager 同样走这一条（本门禁只核对 pnpm）",
      },
    ];
  }

  if (declaredVersion !== running) {
    return [
      {
        kind: "package-manager-drift",
        detail:
          `packageManager 声明 pnpm@${declaredVersion}，当前运行的是 ${running}：` +
          "声明只管「应该用哪个」，管不住 runner 上「实际跑哪个」（检查 corepack 与 pnpm/action-setup）",
      },
    ];
  }

  return [];
}

/**
 * 从 `pnpm@12.0.0` / `pnpm@12.0.0+sha512.<hex>` 里取出 `12.0.0`。
 *
 * ⚠️ 两条约束都是评审 P1 点出来的，缺一条就同时有假绿和误红：
 *
 * - **manager 必须是 `pnpm`**。初版只取最后一个 `@` 之后的版本号，于是
 *   `checkPackageManagerDrift("npm@12.0.0", "12.0.0")` 直接放行——`packageManager`
 *   已经声明成 npm，门禁却报「pnpm 声明与执行一致」（**假绿**）。
 * - **允许 Corepack 的完整性后缀**。`pnpm@12.0.0+sha512.<hex>` 是官方推荐写法，
 *   初版的正则 `^\d+\.\d+\.\d+$` 把它整条判成「解析不出」（**误红**）。
 *
 * 用单条锚定正则而不是 `lastIndexOf("@")` 取段：`packageManager` 的合法形态只有
 * `<name>@<version>` 一种，本门禁只认 `pnpm`。初版用 scoped 包名
 * （`@scope/pkg@1.2.3`）论证 `lastIndexOf` 的必要性，但 scoped 名字**不是合法的
 * package manager**，那条论证不成立，反而放过了 `npm@…`。
 */
const PACKAGE_MANAGER_DECL = /^pnpm@(\d+\.\d+\.\d+)(?:\+[A-Za-z0-9]+\.[A-Za-z0-9]+)?$/;

export function parsePackageManagerVersion(raw: string): string | undefined {
  return PACKAGE_MANAGER_DECL.exec(raw)?.[1];
}