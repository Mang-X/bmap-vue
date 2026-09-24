/**
 * `#44` 冻结前的公共面复核门禁（issue `#104` 实施步骤 6）
 *
 * `#104` 的最后一步是「`#44` 冻结前完成 API / public-dts 复核，**确保内部恢复机制不被误冻结成
 * 公共 API**」。复核的结论如果只写进文档，下一个人加导出时不会看见它 —— 所以这里把结论落成
 * 可回归断言，形状照 `advanced-contract.test.ts`（同一批人维护、同样的口径）。
 *
 * 本文件**刻意只守「已被判定为 REMOVE / 内部化」的那些名字**，不冻结 `./core` 的全量导出面：
 * 「冻结 core 出口」是 #44 的交付物（那时才把精确集合钉死）。#104 负责的是「在冻结之前，
 * 先把不该被冻结的东西收掉」，以及给出一条**会真的变红**的守卫。
 *
 * 三层判定，各自的失效方式不同，因此各自的对照组也不同：
 *
 * 1. **值导出层**：被删/内部化的名字不得出现在公共出口的运行时命名空间里
 *    （`Object.keys` 看得到的就是值导出）。
 * 2. **声明文本层**：类型与选项字段（`Object.keys` 看不到）扫 `dist/*.d.ts` 的**剥注释后**文本。
 *    这一层必须配两个对照：**正证**（同一判定式对一个确实在面上的名字必须命中 —— 它同时挡住
 *    「判定式写歪」与「stripComments 把实现也剥掉了」两种恒真）与**反误报**
 *    （注释里提到这个词不得命中 —— `SdkRegistry.ts` 讲「为什么删掉」的那段 JSDoc 会随产物一起进来）。
 * 3. **机制仍在层**（与 1 放在同一个用例里）：被「内部化」的机制必须**仍然真的在工作**。
 *    只写「它不在出口上」时，「机制被整段删掉」与「机制被内部化」都绿 —— 但审计表写的是后者，
 *    两者结论不同。
 *
 * 需要先 `pnpm build:package`（读 `dist` 的用例都在 `test:unit` 里，CI 的构建顺序在测试之前）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../../packages/test-utils";
import * as advanced from "../../packages/bmap-vue/src/advanced";
import * as components from "../../packages/bmap-vue/src/components";
import * as composables from "../../packages/bmap-vue/src/composables";
import * as core from "../../packages/bmap-vue/src/core";
import * as plugins from "../../packages/bmap-vue/src/plugins";
import * as resolver from "../../packages/bmap-vue/src/resolver";
import * as root from "../../packages/bmap-vue/src";
import {
  getProcessSdkRegistry,
  resetProcessSdkRegistryForTests as registryResetFromSource,
} from "../../packages/bmap-vue/src/core/loader/SdkRegistry";

const PKG_DIR = resolve(import.meta.dirname, "../../packages/bmap-vue");
const DIST = resolve(PKG_DIR, "dist");

/**
 * **七个可静态 import 的公共出口**的运行时命名空间（读 `src/**` 的入口模块，与
 * `advanced-contract.test.ts` 同口径）。
 *
 * 为什么不是「三个主要出口」：`package.json#exports` 有八个入口，第一版只查了根 / `./core` /
 * `./advanced`，评审（2026-09-23）指出「只从 `./components` / `./composables` / `./plugins` /
 * `./resolver` 暴露的值不会触发这条不变量」。虽然这四个入口的名字当时都被根入口 re-export，
 * 但那是**当时的巧合**而不是保证（`./plugins` 已经在 re-export `../core/plugins/PluginHost`，
 * 说明子入口可以自己加东西）⇒ 逐个列上，不依赖「根入口覆盖了它们」。
 *
 * 唯一例外是第八个入口 `./ui-kit`：它**不能静态 import**（无 DOM 环境 import 即失败，见
 * `AGENTS.md` 的 ui-kit 硬约束）⇒ 由**声明文本层**覆盖（`readDtsText()` 扫 `dist/*.d.ts` 的全部
 * 八个入口，`./ui-kit` 在其中），并且 `*ForTests` 那条不变量在声明文本层对**标识符**扫，不看名单。
 */
const ENTRIES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["根入口", root as unknown as Record<string, unknown>],
  ["./components", components as unknown as Record<string, unknown>],
  ["./composables", composables as unknown as Record<string, unknown>],
  ["./plugins", plugins as unknown as Record<string, unknown>],
  ["./resolver", resolver as unknown as Record<string, unknown>],
  ["./core", core as unknown as Record<string, unknown>],
  ["./advanced", advanced as unknown as Record<string, unknown>],
];

/**
 * 被判定 **REMOVE（值导出）** 的名字：不得出现在任何公共出口的运行时命名空间里。
 *
 * - `useMapResource`：零生产消费者，被 `useSdkResource` 取代（后者文件头写着它「替代行为各异的
 *   `useMapResource`/`useOverlayResource`/`useControlResource`/`useLayerResource`」）。它随
 *   `./core` 一起会被冻结进 3.0。
 * - `resetProcessSdkRegistryForTests`：「for tests」写在名字里，公共声明面不该有它。
 */
/**
 * #139：服务任务原语内部化。`useServiceTask` / `SupersedeMode` / `SupersedePolicy` /
 * `useSimpleServiceTask` / `useExclusiveServiceTask` / `ServiceInstanceChannel` 都是**内部实现**——
 * 12 个服务 composable 的出口是公共面，任务内核的状态机不是（把内部状态机冻结成公共 API
 * 就等于承诺它不再变，而 #139 恰好在做收口）。
 */
const REMOVED_VALUE_EXPORTS = [
  "useMapResource",
  "resetProcessSdkRegistryForTests",
  "useServiceTask",
  "useSimpleServiceTask",
  "useExclusiveServiceTask",
  "createSharedInstanceChannel",
  "createExclusiveInstanceChannel",
];

/**
 * 被判定 **REMOVE / 内部化（类型或选项字段）** 的名字：不得出现在公共声明面。
 *
 * `Object.keys` 看不到它们，因此只能扫声明文本；它们的共同点是「随 `./core` 冻结就会被承诺」。
 */
const REMOVED_TYPE_OR_FIELD_NAMES = [
  "useMapResource",
  // #139：任务内核与实例通道的类型面（见 REMOVED_VALUE_EXPORTS 上方的理由）。
  "useServiceTask",
  "UseServiceTaskOptions",
  "ServiceTask",
  "SupersedeMode",
  "SupersedePolicy",
  "ServiceInstanceChannel",
  "ExclusiveInstanceChannelOptions",
  "ServiceTaskCore",
  "ServiceTaskState",
  "SdkResourceAdapter",
  "UseMapResourceResult",
  "SdkConflictPolicy",
  "SdkConflictInfo",
  "conflictPolicy",
  "onConflict",
  "resetProcessSdkRegistryForTests",
];

/** 剥注释后文本里是否出现了某个**标识符**（带词边界，避免 `conflictPolicyX` 满足 `conflictPolicy`）。 */
function mentions(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(stripComments(text));
}

/**
 * `package.json#exports` 里声明的公共入口数（排除 `./package.json` 那一项）。
 *
 * 用它当「dist 顶层该有几个 `.d.ts`」的判据，而不是写死一个数字：入口面变化时这条断言会自己跟上，
 * 同时它仍然是一条**非空转守卫** —— 目标数量与产物数量不符时说明判定没有作用在全部入口上。
 */
const declaredPublicEntries = (): number => {
  const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>;
  };
  const entries = Object.keys(pkg.exports ?? {}).filter((key) => key !== "./package.json");
  expect(entries.length, "package.json#exports 的入口面为空，判定没有着力点").toBeGreaterThan(0);
  return entries.length;
};

const publicDtsFiles = (): string[] => {
  if (!existsSync(DIST)) {
    throw new Error(`缺少构建产物目录 ${DIST}：先跑 \`pnpm build:package\`（读 dist 的用例都在 test:unit 里）`);
  }
  const files = readdirSync(DIST).filter((name) => name.endsWith(".d.ts"));
  // 空转守卫：判定必须作用在**全部**公共入口上，而不是其中一个子集上。
  expect(
    files.length,
    `dist 顶层的 .d.ts 数量与 package.json#exports 的入口数不符（${files.length} vs ${declaredPublicEntries()}）`,
  ).toBe(declaredPublicEntries());
  return files.map((name) => resolve(DIST, name));
};

const readDtsText = (): string => publicDtsFiles().map((file) => readFileSync(file, "utf8")).join("\n");

describe("公共出口不得出现测试辅助（`*ForTests`）", () => {
  /**
   * 判定式：名字以 `ForTests` 结尾。
   *
   * 这条是**可推广的不变量**（不是一次性清单）：测试辅助一旦出现在公共面，就会随出口一起被冻结成
   * 3.0 的承诺面，而它显然不该被承诺。
   *
   * **两层都要查**，因为它的两种载体不同（评审 2026-09-23 的 P2 指的正是第一版只查了值导出）：
   * - **值导出**：`Object.keys` 看得到 ⇒ 逐个入口扫命名空间；
   * - **类型导出与其它子入口**：`Object.keys` 看不到类型，而只从某个子入口暴露的值也不在根入口里
   *   ⇒ 扫**全部八个声明入口**的**标识符**（不是扫名单）。后者才让「将来新增一个 `FooForTests`」
   *   也会被抓住，而不是只守已经知道的那一个。
   */
  const isTestHelper = (names: readonly string[]): string[] =>
    names.filter((name) => name.endsWith("ForTests"));

  /** 剥注释后文本里出现的 `*ForTests` **标识符**（去重排序，便于断言消息可读）。 */
  const testHelperIdentifiersIn = (text: string): string[] => {
    const matches = stripComments(text).match(/\b[A-Za-z_$][\w$]*ForTests\b/g) ?? [];
    return [...new Set(matches)].sort();
  };

  it("运行时导出层：七个入口都没有 `*ForTests`（判定式的正证在本用例内自证）", () => {
    // 正证：用**同一条判定式**作用在一份含已知命中的合成输入上。少了这一段，
    // 「判定式写歪导致恒不命中」会让下面的负向断言静默变绿 —— 而它看起来完全一样。
    expect(isTestHelper(["useSdkResource", "resetProcessSdkRegistryForTests"])).toEqual([
      "resetProcessSdkRegistryForTests",
    ]);

    for (const [label, entry] of ENTRIES) {
      const names = Object.keys(entry);
      // 空转守卫：这一处确实有导出面可查（否则下面的断言在空集合上恒真）。
      expect(names.length, `${label} 的导出面为空，判定没有着力点`).toBeGreaterThan(0);
      expect(isTestHelper(names), `${label} 泄漏了测试辅助`).toEqual([]);
    }
  });

  it("声明文本层：**任意** `*ForTests` 标识符都不得出现（含类型导出与 `./ui-kit`）", () => {
    // 正证 1（判定式本身）：同一判定式作用在合成输入上必须命中，且**值导出与类型导出两种形态**都要覆盖
    // （后者正是运行时层结构上看不见的那一类）—— 挡住「判定式写歪」这类恒真。
    expect(testHelperIdentifiersIn("export declare function resetFooForTests(): void;")).toEqual([
      "resetFooForTests",
    ]);
    expect(testHelperIdentifiersIn("export type BarForTests = { ok: boolean };")).toEqual(["BarForTests"]);
    // 反误报：注释里的提及不得命中（`SdkRegistry.ts` 的历史注记就是这种形态）。
    expect(testHelperIdentifiersIn("// resetFooForTests 是测试辅助，已在两处收口\n")).toEqual([]);

    // 这里**刻意不**再要求「src 里必须还存在一个 `*ForTests` 导出」（评审 2026-09-23 第二轮）：
    // 那会把一条**公共面**不变量反向绑到**内部实现**是否还在上 —— 将来合法地删掉最后一个内部
    // 测试辅助时，公共面仍然应该禁止 `*ForTests`，而那条守卫会先假红。判定式有没有着力点由上面
    // 两条合成正证证明；判定对象是不是真的内容由下面逐文件的「剥注释后非空」证明。

    // 负向：**逐个**声明入口（含不能静态 import 的 `./ui-kit`）都零命中，
    // 且每个入口各自再验一次「读得到内容」——防「文件读空 / 读歪」让负向恒绿。
    const leaks: string[] = [];
    for (const file of publicDtsFiles()) {
      const raw = readFileSync(file, "utf8");
      const stripped = stripComments(raw);
      expect(stripped.trim().length, `${file} 剥注释后为空，判定没有着力点`).toBeGreaterThan(0);
      for (const name of testHelperIdentifiersIn(raw)) {
        leaks.push(`${file.split("/").pop()}: ${name}`);
      }
    }
    expect(leaks, `公共声明面泄漏了测试辅助：${leaks.join(", ")}`).toEqual([]);
  });
});

describe("被判定 REMOVE / 内部化的名字不得出现在公共面（#104 第三批）", () => {
  it("值导出：七个出口都没有它们；且被「内部化」的那个机制**真的还在工作**", () => {
    for (const [label, entry] of ENTRIES) {
      const names = new Set(Object.keys(entry));
      const leaked = REMOVED_VALUE_EXPORTS.filter((name) => names.has(name));
      expect(leaked, `${label} 仍然导出被删除的值导出：${leaked.join(", ")}`).toEqual([]);
    }

    // 同一命题的另一半：`resetProcessSdkRegistryForTests` 是**内部化**而不是删除。
    // 只断言「它不在出口上」时，「机制被整段删掉」与「机制被内部化」都会绿 ——
    // 而审计表写的是后者。所以这里断言它**仍然能真的重置进程级域**，而不只是
    // 「还 import 得到一个同名函数」（换成空壳也满足后者）。
    const domain = "core-surface-internalised-probe";
    const options = { domain };
    try {
      const first = getProcessSdkRegistry(domain, options);
      registryResetFromSource();
      const second = getProcessSdkRegistry(domain, options);
      expect(second, "resetProcessSdkRegistryForTests 没有真的重置进程级域").not.toBe(first);
    } finally {
      // 收尾：进程级状态不留给别的用例（它按 realm 共享）。
      registryResetFromSource();
    }
  });

  it("声明文本：剥注释后不得再出现（正证 + 反误报 + 未剥对照，同一条判定式）", () => {
    const coreDts = readFileSync(resolve(DIST, "core.d.ts"), "utf8");

    // 正证：判定式对一个**确实在**公共声明面里的名字必须命中。它同时挡住两种恒真：
    // 「判定式写歪」与「stripComments 把实现也剥掉了」—— 后者会让下面的负向断言永远通过。
    expect(mentions(coreDts, "SdkRegistryOptions"), "正证失败：判定式连在面上的名字都读不到").toBe(true);
    expect(mentions(coreDts, "getProcessSdkRegistry"), "正证失败：判定式读不到值导出").toBe(true);

    // 反误报（三种注释形态，同一个判定式）：注释里的提及不得命中。
    // 这段 JSDoc 的**真实样本**就在产物里（`SdkRegistry.ts` 讲「为什么删掉」的那段会随
    // `SdkRegistryOptions` 的 JSDoc 进 `dist/core.d.ts`），下一段断言就是在真产物上比的。
    expect(mentions("// 曾经有 SdkConflictPolicy\n", "SdkConflictPolicy")).toBe(false);
    expect(mentions("/* useMapResource 已被取代 */\n", "useMapResource")).toBe(false);
    expect(mentions("const x = 1; // onConflict 见说明\n", "onConflict")).toBe(false);

    const raw = readDtsText();
    // 真实产物上的「未剥 vs 剥后」对照：证明 stripComments 是 **load-bearing** 的，
    // 而不是一层从没生效过的装饰。若哪天那批历史注记被清掉，这条会红并提示可以简化本用例。
    const rawHits = REMOVED_TYPE_OR_FIELD_NAMES.filter((name) =>
      new RegExp(`\\b${name}\\b`).test(raw),
    );
    expect(
      rawHits.length,
      "产物里已经没有把这些名字写在 JSDoc 里的说明 —— stripComments 不再 load-bearing，本用例的反误报段可以简化",
    ).toBeGreaterThan(0);

    // 负向：剥掉注释之后，真实产物里一个都不许有。
    const leaked = REMOVED_TYPE_OR_FIELD_NAMES.filter((name) => mentions(raw, name));
    expect(leaked, `公共声明面仍然暴露被内部化的机制：${leaked.join(", ")}`).toEqual([]);
  });
});

describe("包级前提（避免上面几条对着一个被改坏的 exports 断言）", () => {
  it("`./core` 子路径指向 ESM 产物，且产物真的在", () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG_DIR, "package.json"), "utf8")) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };
    expect(pkg.exports?.["./core"]?.import).toBe("./dist/core.mjs");
    expect(pkg.exports?.["./core"]?.types).toBe("./dist/core.d.ts");
    expect(existsSync(resolve(DIST, "core.mjs"))).toBe(true);
    expect(existsSync(resolve(DIST, "core.d.ts"))).toBe(true);
  });
});
