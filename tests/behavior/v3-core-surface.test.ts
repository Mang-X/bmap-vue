/**
 * `#44` 冻结前的公共面复核门禁（issue `#104` 实施步骤 6）
 *
 * `#104` 的最后一步是「`#44` 冻结前完成 API / public-dts 复核，**确保内部恢复机制不被误冻结成
 * 公共 API**」。复核的结论如果只写进文档，下一个人加导出时不会看见它 —— 所以这里把结论落成
 * 可回归断言，形状照 `v3-advanced-contract.test.ts`（同一批人维护、同样的口径）。
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
 * 需要先 `pnpm build:v3`（读 `dist` 的用例都在 `test:unit` 里，CI 的构建顺序在测试之前）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../../packages/test-utils";
import * as advanced from "../../packages/baidu-map-gl-vue/src/advanced";
import * as core from "../../packages/baidu-map-gl-vue/src/core";
import * as root from "../../packages/baidu-map-gl-vue/src";
import {
  getProcessSdkRegistry,
  resetProcessSdkRegistryForTests as registryResetFromSource,
} from "../../packages/baidu-map-gl-vue/src/core/loader/SdkRegistry";

const PKG_DIR = resolve(import.meta.dirname, "../../packages/baidu-map-gl-vue");
const DIST = resolve(PKG_DIR, "dist");

/**
 * 三个**主要公共出口**的运行时命名空间（读的是 `src/**` 的入口模块，与 `v3-advanced-contract.test.ts` 同口径）。
 *
 * 覆盖缺口是显式的：`./components` / `./composables` / `./plugins` / `./resolver` 的名字都被根入口
 * 逐个 re-export，因此已在其中；`./ui-kit` **不能静态 import**（无 DOM 环境 import 即失败，见
 * `AGENTS.md` 的 ui-kit 硬约束）⇒ 这两类由下面的**声明文本层**覆盖：`readDtsText()` 扫的是
 * `dist/*.d.ts` 的**全部八个入口**，`./ui-kit` 在其中。
 */
const ENTRIES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["根入口", root as unknown as Record<string, unknown>],
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
const REMOVED_VALUE_EXPORTS = ["useMapResource", "resetProcessSdkRegistryForTests"];

/**
 * 被判定 **REMOVE / 内部化（类型或选项字段）** 的名字：不得出现在公共声明面。
 *
 * `Object.keys` 看不到它们，因此只能扫声明文本；它们的共同点是「随 `./core` 冻结就会被承诺」。
 */
const REMOVED_TYPE_OR_FIELD_NAMES = [
  "useMapResource",
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

const publicDtsFiles = (): string[] => {
  if (!existsSync(DIST)) {
    throw new Error(`缺少构建产物目录 ${DIST}：先跑 \`pnpm build:v3\`（读 dist 的用例都在 test:unit 里）`);
  }
  const files = readdirSync(DIST).filter((name) => name.endsWith(".d.ts"));
  expect(files.length, "dist 顶层应当有多个 .d.ts 入口").toBeGreaterThan(3);
  return files.map((name) => resolve(DIST, name));
};

const readDtsText = (): string => publicDtsFiles().map((file) => readFileSync(file, "utf8")).join("\n");

describe("公共出口不得出现测试辅助（`*ForTests`）", () => {
  /**
   * 判定式：名字以 `ForTests` 结尾。
   *
   * 这条是**可推广的不变量**（不是一次性清单）：测试辅助一旦出现在公共声明面，就会随
   * `./core` / 根入口一起被冻结成 3.0 的承诺面，而它显然不该被承诺。
   */
  const isTestHelper = (names: readonly string[]): string[] =>
    names.filter((name) => name.endsWith("ForTests"));

  it("三个主要出口的运行时导出里都没有 `*ForTests`（判定式的正证在本用例内自证）", () => {
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
});

describe("被判定 REMOVE / 内部化的名字不得出现在公共面（#104 第三批）", () => {
  it("值导出：三个主要出口没有它们；且被「内部化」的那个机制**真的还在工作**", () => {
    for (const [label, entry] of ENTRIES) {
      const names = new Set(Object.keys(entry));
      const leaked = REMOVED_VALUE_EXPORTS.filter((name) => names.has(name));
      expect(leaked, `${label} 仍然导出被删除的值导出：${leaked.join(", ")}`).toEqual([]);
    }

    // 同一命题的另一半：`resetProcessSdkRegistryForTests` 是**内部化**而不是删除。
    // 只断言「它不在出口上」时，「机制被整段删掉」与「机制被内部化」都会绿 ——
    // 而审计表写的是后者。所以这里断言它**仍然能真的重置进程级域**，而不只是
    // 「还 import 得到一个同名函数」（换成空壳也满足后者）。
    const domain = "v3-core-surface-internalised-probe";
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
