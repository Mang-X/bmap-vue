/**
 * `check:dts-strict` 门禁自测（issue #188）
 *
 * 这道门禁替代的是 `check:api` 里原先那条「断言 index/components **仍然**因 Volar
 * 悬空引用而分析失败」的探针。两者判据方向相反，所以本文件要钉住的东西与
 * `api-forgotten-exports-gate.test.ts` 同源但不同：
 *
 * 1. **门禁真的接进了 CI，且没有被 `continue-on-error` 架空**。原探针活在
 *    `check:api` 里，那道门禁本来就在 CI 上；新门禁是**新脚本 + 新 npm script**，
 *    漏接线不会让任何东西变红 —— 新增门禁最典型的失效方式就是「写了但没跑」。
 * 2. **判据是 `skipLibCheck: false`**。全仓库原本只有 `tsconfig.build.json` 是 `false`，
 *    而它编的是 `src/` 不是 `dist/`。若有人把探针的这份改成 `true`（或复用
 *    `fixtures/consumer/tsconfig.json`），`.d.ts` 内部就完全不被检查，门禁恒绿。
 * 3. **探针的正反两侧都在**。只测正向的话，「声明面整体退化成 `any`」会让编译恒真。
 *    这里断言负向断言（`@ts-expect-error`）确实存在且**数量与覆盖面**不退化。
 * 4. **探针覆盖全部七个出口**。少 import 一个，那道出口就没人验，而门禁仍然全绿。
 *
 * 判据刻意**不**在这里跑真实编译：那要 `pnpm build:package` 出 `dist/`，而 `dist/`
 * 正是 `export-surface-freeze` / `core-surface` / `doc-props-gate` 等**并行**读的��象
 * （`api-forgotten-exports-gate.test.ts` 里记着同一个坑：实测让 11 个用例随机变红）。
 * 真实编译由 `pnpm check:dts-strict` 在 CI 里跑；这里守的是「这道门禁的判据没被改空」。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { calledSetupMacros, probeImportSpecifiers } from "../../scripts/source-scan.mts";
import {
  FORGOTTEN_ZERO_TOLERANCE_ENTRIES,
  newForbiddenForgottenExports,
  publicForgottenExports,
  VOLAR_MACHINE_NAME,
} from "../../scripts/api-forgotten-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, "packages/bmap-vue/package.json"), "utf8"),
) as { exports: Record<string, unknown> };

/** 读某出口的未导出类型身份集合基线；缺失即抛（缺失本身是缺陷，不该被读成空集）。 */
function readForgotten(entry: string): string[] {
  const target = resolve(ROOT, `packages/bmap-vue/etc/${entry}/forgotten-exports.json`);
  if (!existsSync(target)) throw new Error(`身份集合基线缺失：${target}`);
  return JSON.parse(readFileSync(target, "utf8")) as string[];
}

/**
 * 组件 manifest 的**全部**出口名（单一事实源：`src/manifest.ts`）。
 *
 * 探针的「每个组件都断言一遍」必须与它对齐，所以名单从 manifest **派生**而不是抄一份。
 * 直接 import 源码而不是读生成的 JSON：`src/manifest.ts` 才是事实源，生成物可能滞后。
 */
function readComponentManifest(): string[] {
  const source = readFileSync(resolve(ROOT, "packages/bmap-vue/src/manifest.ts"), "utf8");
  const block = /export const componentManifest = \[([\s\S]*?)\n\] as const;/.exec(source)?.[1];
  if (block === undefined) throw new Error("读不到 componentManifest 的字面量");
  return [...block.matchAll(/exportName:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/**
 * 消费方的子路径（`package.json#exports` 的键去掉 `./`）。
 *
 * 排除两类**没有声明可验**的出口：
 * - `./package.json`：meta，不是模块；
 * - `./volar`：纯 `types` 出口，探针按 `compilerOptions.types` 验（另有专测），
 *   不以 `import` 形式进入 program；
 * - `./styles.css`（#189）：**纯资源出口**，它是一条 CSS，不产出也不该产出 `.d.ts`。
 *   把 `.d.ts` 的严格消费判据套到它身上只会逼出一份假声明（ADR 2026-10-02 明确拒绝）。
 *
 * ⚠️ 排除的判据是「**声明文件不存在**」而不是「名字长这样」：写死名单时，将来一条
 * 新的资源出口会静默落到「探针没 import」的红里，而原因是判据本身没跟上出口形态。
 */
const SUBPATHS = Object.keys(MANIFEST.exports)
  .filter((key) => key !== "./volar" && key !== "./package.json" && key !== "./styles.css")
  .map((key) => (key === "." ? "@mangax/bmap-vue" : `@mangax/bmap-vue/${key.slice(2)}`));

describe("门禁接线", () => {
  it("CI 真的跑 check:dts-strict，且排在 build:package 之后", () => {
    const workflow = readWorkflow("quality.yml");
    const block = stepBlockContaining(workflow, "check:dts-strict");
    expect(block.length, "CI 里找不到 check:dts-strict 这一步").toBeGreaterThan(0);
    expect(block.join("\n")).not.toContain("continue-on-error");
    // 判据的输入是 dist/**/*.d.ts，排在 build 之前必然读到上一次的产物或空目录。
    const gateAt = workflow.indexOf("check:dts-strict");
    const buildAt = workflow.indexOf("build-package.mts");
    expect(gateAt, "CI 里找不到 build:package 这一步").toBeGreaterThan(0);
    expect(gateAt, "check:dts-strict 必须排在 build:package 之后").toBeGreaterThan(buildAt);
  });

  it("npm script 指向的脚本文件存在，且真的开了 skipLibCheck: false", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const command = rootManifest.scripts["check:dts-strict"];
    expect(command, "package.json 里没有 check:dts-strict script").toBeTruthy();
    expect(command).toContain("scripts/check-dts-strict.mts");

    const script = readFileSync(resolve(ROOT, "scripts/check-dts-strict.mts"), "utf8");
    // 判据的**全部意义**在这一行。改成 true，.d.ts 内部就不被检查，门禁恒绿。
    expect(script, "门禁脚本里必须显式写 skipLibCheck: false").toMatch(/skipLibCheck:\s*false/);
    // 反向：不得**生效**地把它设回 true。刻意剥掉注释再查 —— 脚本的文档注释里
    // 合法地讨论着「别把它设成 true」（那正是这段判据的来由），按全文查会假红。
    // 生效的设置只可能出现在 `ts.createProgram({...})` 的实参里，这里按行首缩进取。
    const code = script
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
      .join("\n");
    expect(code, "门禁脚本把 skipLibCheck 改回了 true").not.toMatch(/skipLibCheck:\s*true/);
  });
});

describe("探针的判别力（正反两侧）", () => {
  const probe = readFileSync(resolve(ROOT, "fixtures/consumer/strict/probe.ts"), "utf8");

  it("探针显式要求 skipLibCheck: false（那份 tsconfig 是判据的一部分）", () => {
    const tsconfig = JSON.parse(
      readFileSync(resolve(ROOT, "fixtures/consumer/strict/tsconfig.json"), "utf8"),
    ) as { compilerOptions: Record<string, unknown> };
    expect(tsconfig.compilerOptions.skipLibCheck, "严格消费配置必须关掉 skipLibCheck").toBe(false);
    expect(tsconfig.compilerOptions.strict, "严格消费配置必须开 strict").toBe(true);
  });

  it("负向断言存在（否则「声明面退化成 any」会让整道门禁恒真）", () => {
    const expectErrors = probe.match(/@ts-expect-error/g) ?? [];
    expect(
      expectErrors.length,
      "探针里一条 @ts-expect-error 都没有 ⇒ 只测了正向，声明面整体退化成 any 时门禁仍然全绿",
    ).toBeGreaterThanOrEqual(3);
  });

  it("负向断言同时覆盖「成员不存在」与「成员类型写错」两类", () => {
    // 只有「成员不存在」这一类是不够的：把某个 prop 的类型放宽成 `any`（索引签名）
    // 不会让它消失，只会让值类型检查失效。两类都要在。
    expect(probe, "缺少「成员不存在」的负向断言").toMatch(
      /@ts-expect-error[^\n]*\n\s*totallyNotARealProp:/,
    );
    expect(probe, "缺少「成员类型写错」的负向断言").toMatch(
      /@ts-expect-error[^\n]*\n\s*zoom: "/,
    );
  });

  it("正侧断言存在（合法 prop 与插槽类型都能取用）", () => {
    expect(probe, "探针没有断言合法 props 可用").toMatch(/const okProps: MapProps = \{[^}]*\}/);
    // 插槽类型是 #188 的核心修复面：此前 `$slots` 引用的是已被打包阶段丢弃的标识符。
    expect(probe, "探针没有断言 $slots 可取用").toMatch(/const \$slots: SlotsOf|MapSlots|ProviderSlots/);
  });

  /**
   * 探针的「每个组件」断言必须**覆盖组件 manifest 的全部出口名**（#188 评审 P2）。
   *
   * 首轮只探了 `Marker` / `BMapProvider` / `Map` 三个采样点，实测把 `ZoomControl` 的
   * 载荷换回 `Record<string, never>` 门禁**照样全绿** —— 采样点之外等于没盖。
   * 现在探针里是逐组件的实例化断言（`_slotHasNoIndex_<Name>`），这条把那份名单钉在
   * manifest 上：**新增一个组件却忘了加断言**会立刻变红。
   *
   * 两个方向都比：manifest 有而探针没有（新组件漏了）、探针有而 manifest 没有
   * （探针里留了一个已经不存在的名字，判据正在守一个不存在的组件）。
   */
  it("探针对 manifest 的每个组件都有插槽载荷断言（不多不少）", () => {
    const manifest = readComponentManifest();
    const asserted = [...probe.matchAll(/const _slotHasNoIndex_(\w+):/g)].map((m) => m[1]!);
    expect(
      asserted.length,
      "探针里一条 `_slotHasNoIndex_*` 断言都没有 —— 判据没有着力点",
    ).toBeGreaterThanOrEqual(50);

    const assertedSet = new Set(asserted);
    const missing = manifest.filter((name) => !assertedSet.has(name));
    expect(
      missing,
      `这些组件在 manifest 里却没有插槽载荷断言 ⇒ 它们的载荷退化成索引签名时门禁不会红：${missing.join(", ")}`,
    ).toEqual([]);

    const manifestSet = new Set(manifest);
    const extra = [...assertedSet].filter((name) => !manifestSet.has(name));
    expect(extra, `探针断言了 manifest 里不存在的组件：${extra.join(", ")}`).toEqual([]);
  });

  it("名单从组件 manifest 派生，而不是在用例里抄一份", () => {
    // 抄一份的话，加组件时两处会静默漂移，而其中一份没人读（AGENTS.md：
    // 「只查数字抓不到『数量对了但漏列』」，这里同理）。
    expect(
      readComponentManifest().length,
      "manifest 读不出来 —— 判据会落在空集上",
    ).toBeGreaterThanOrEqual(50);
  });

  it("插槽载荷的成员类型被断言（退化成 any 时会红）", () => {
    expect(
      probe,
      "探针只断言了 $slots 存在，没断言载荷成员 —— 载荷写成 any 时门禁不会红",
    ).toMatch(/status:\s*unknown;[\s\S]{0,120}?client:\s*unknown/);
  });

  /**
   * 断言必须**实例化**（#188 评审 P1）。
   *
   * 未实例化的类型别名是**惰性**的：TypeScript 只在别名被真正求值时才检查其内部。
   * 所以 `export type _Root = NotAny<any>` 单独编译是**零错误**（实测）——
   * 写成 `type` 的「反 any 防御」根本没有牙：声明面整体退化成 `any` 时门禁照样全绿。
   *
   * 这条判据按**形状**钉住：断言语句必须是 `const _x: T = true` 形态，
   * 且那一行不能是 `type` 声明。
   */
  it("断言是实例化的（const x: T = true），不是惰性的 type 别名", () => {
    // 探针里必须有实例化的断言语句（`const _x: <类型> = true`）——那才是会被检查的形态。
    const instantiated = probe.match(/^const\s+_\w+:[^;]*=\s*true;/gm) ?? [];
    expect(
      instantiated.length,
      "探针里没有 `const _x: T = true` 形态的实例化断言 —— 未实例化的 type 别名是惰性的，" +
        "导出退化成 any 时不会让门禁变红",
    ).toBeGreaterThanOrEqual(2);

    // 反过来：不允许把反 any 断言写成未实例化的 type 别名。
    // 刻意剥掉注释再查 —— 探针的文件头**合法地**引用了这个反例形态来说明为什么
    // 不能那样写，按全文查会假红。
    const code = probe
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(code, "反 any 断言被写成了惰性的 `export type _Root = [...]`").not.toMatch(
      /export type _\w+\s*=\s*\[/,
    );
  });
});

describe("探针覆盖全部出口", () => {
  /**
   * 覆盖判据与门禁脚本读的是**同一份逻辑**（真实 `ImportDeclaration`，#188 评审 P2）。
   *
   * 原先这里与 `check-dts-strict.mts` 各写一份正则，两层一起被注释骗过 ——
   * `// import { X } from "@mangax/bmap-vue/ui-kit"` 两边都命中，而那个出口
   * 实际不在 TypeScript program 里，严格检查根本没跑它。两侧改成读同一个判定，
   * 「脚本改了判据、用例没跟」这个漂移面就没了。
   */
  function importedByProbe(): Set<string> {
    const probePath = resolve(ROOT, "fixtures/consumer/strict/probe.ts");
    return probeImportSpecifiers(probePath, readFileSync(probePath, "utf8"));
  }

  it("package.json#exports 的每个子路径都被探针 import 了", () => {
    const imported = importedByProbe();
    const missing = SUBPATHS.filter((subpath) => !imported.has(subpath));
    expect(
      missing,
      `这些出口在 exports 里存在但探针没 import ⇒ 它们的声明没人验：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("出口名单非空（判据没有着力点时上面那条会恒真）", () => {
    expect(SUBPATHS.length).toBeGreaterThanOrEqual(7);
  });

  /**
   * 被排除的出口必须有**说得出的**排除理由，而不是「名字被列进了排除名单」。
   *
   * 这条守的是上面那条排除的**失效方向**：如果有人把某个 JS 出口加进排除名单，
   * 上面那条 `missing` 会静默变绿（那个出口的声明就没人验了），而本仓库最容易发生的
   * 恰好是「加了一个出口、忘了让探针覆盖」。
   *
   * 两类合法排除（逐个点名，且各自在本文件里都有对应的判据）：
   * - `./package.json`：meta，不是模块；
   * - `./volar`：**有** `.d.ts`，但它不以 `import` 形式进 program ——
   *   用户按 `compilerOptions.types` 使用它，由本文件的 `./volar` 专测 + `verify:package`
   *   的 Volar 探针覆盖（那是这件事真正的消费路径）。
   *
   * 除此之外的出口（尤其是任何带 `.d.ts` 的**运行时**出口）一律该出现在探针里。
   */
  it("被排除的出口只有 meta 与按 types 使用的 ./volar（否则「排除」会掩盖漏验）", () => {
    const probeSpecOf = (key: string): string =>
      key === "." ? "@mangax/bmap-vue" : `@mangax/bmap-vue/${key.slice(2)}`;
    const excluded = Object.keys(MANIFEST.exports).filter(
      (key) => !SUBPATHS.includes(probeSpecOf(key)),
    );
    // 正证：确实有被排除的出口（不是空集上的恒真）。
    expect(excluded.length, "没有被排除的出口 —— 判据没有着力点").toBeGreaterThan(0);
    expect(
      [...excluded].sort(),
      "出现了一个没被登记的排除出口：它要么该被探针 import，要么该在此写明理由",
    ).toEqual(["./package.json", "./styles.css", "./volar"]);

    // `./volar` 是「有声明、但按 types 使用」的**唯一**一个，必须显式承认这件事，
    // 而不是靠一条笼统的「排除名单」把它带过。
    expect(
      (MANIFEST.exports as Record<string, { types?: string }>)["./volar"]?.types,
      "./volar 的排除理由就是「有声明但按 compilerOptions.types 使用」",
    ).toBe("./volar.d.ts");
  });

  it("注释掉的 import 不算覆盖（判据的可核对性）", () => {
    // 合成样本：只有注释、没有 ImportDeclaration。门禁脚本那份判据必须判为未覆盖。
    const commented = '// import { X } from "@mangax/bmap-vue/ui-kit";\nexport {};\n';
    expect(
      commented.includes("@mangax/bmap-vue/ui-kit"),
      "样本自身没提到该 specifier，样本无效",
    ).toBe(true);
    expect(
      probeImportSpecifiers("commented.ts", commented).has("@mangax/bmap-vue/ui-kit"),
      "注释掉的 import 被算成覆盖 —— 判据是文本查找而不是 AST",
    ).toBe(false);
  });

  it("门禁脚本与用例读的是同一个判定（不留第二份实现）", () => {
    // 两处各写一份实现时，一次修改只落在一处，两层会一起误绿。这里钉住「只有一处实现」。
    //
    // 判据刻意匹配**字面 token**（`new RegExp` / 旧函数名 `probeImports`）而不是
    // 那条正则的源码形状：源码形状要跟 JS 的字符串转义对齐，写出来的 `/from\\s\*/`
    // 实际匹配的是「反斜杠 + s」而不是「反斜杠 + s + 星号」—— 首版就是这么写的，
    // 它**对 HEAD 的旧实现也不匹配**，于是这条「反漂移」判据恒绿、恒无牙（#188 评审 P2）。
    // token 匹配没有转义层：旧实现里那两个词一定在。
    const script = readFileSync(resolve(ROOT, "scripts/check-dts-strict.mts"), "utf8");
    const code = script
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(
      code,
      "check-dts-strict.mts 里又出现了一份 import 覆盖的文本查找 —— " +
        "判据必须只有 probeImportSpecifiers 一处实现",
    ).not.toContain("new RegExp");
    expect(code, "旧的 probeImports 文本判据回来了").not.toContain("probeImports");
    expect(
      code,
      "门禁脚本没有引用共享判据 —— 它自己那份实现去哪了？",
    ).toContain("probeImportSpecifiers");
  });
});

/**
 * 补齐 `defineSlots` 的**判据**（#188 评审）。
 *
 * 首轮只改了 47 个组件，另 5 个（`components/data/*` 的 `generic="Item"` 泛型组件）
 * 因为「当时恰好 emit 成合法形态」没被改 —— 但那不是判据：换个 Volar 版本或改一下
 * 模板就可能退回悬空形态，而当时**没有任何门禁会红**。这条把「哪些组件需要
 * `defineSlots`」从一次性的人肉清单变成可核对的规则。
 *
 * 判据取自源码而非产物：`<slot>` 出现在模板里就要求有 `defineSlots`，两条一起读。
 * 只查产物的话，泛型组件那条路径（无法提升成顶层别名）会让判据依赖打包器的实现细节。
 */
describe("defineSlots 的覆盖面（不允许「当时恰好合法」）", () => {
  const SRC = resolve(ROOT, "packages/bmap-vue/src");

  function collectVueFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) collectVueFiles(full, out);
      else if (entry.name.endsWith(".vue")) out.push(full);
    }
    return out;
  }

  const slotted = collectVueFiles(SRC).filter((file) => {
    const source = readFileSync(file, "utf8");
    // 只认模板段：`<slot` 也可能出现在注释或字符串里。全库现无此情况，
    // 但判据写成「模板里有」比「文件里有」准，且代价相同。
    const template = source.split("</script>")[1] ?? "";
    return /<slot[\s/>]/.test(template);
  });

  it("扫描到了带 <slot> 的组件（名单为空时下面两条会恒真）", () => {
    expect(slotted.length, "没有扫到任何带 <slot> 的组件，判据没有着力点").toBeGreaterThanOrEqual(50);
  });

  it.each(
    slotted.map((file) => [file.replace(ROOT + "/", ""), file] as const),
  )("%s 真的调用了 defineSlots", (_label, file) => {
    const macros = calledSetupMacros(file, readFileSync(file, "utf8"));
    expect(
      macros.has("defineSlots"),
      `${file.replace(ROOT + "/", "")} 模板里有 <slot> 却没有**调用** defineSlots —— ` +
        `vue-tsc 会把载荷 emit 成模块局部的 \`declare var __VLS_N\`，` +
        `而声明打包阶段只保留导出面可达的符号，那条声明连同其声明一起消失，` +
        `留下悬空引用（#188）。\n` +
        `  判据读的是真实的 CallExpression：本仓库每个组件都带一段解释「为什么要写 ` +
        `defineSlots」的注释，注释里必然出现这个单词，按文本查会恒真（#188 评审 P1）。`,
    ).toBe(true);
  });

  it("泛型组件也在名单里（它们正是首轮被漏掉的那五个）", () => {
    // 泛型组件无法把插槽类型提升成顶层别名，emit 形态与普通组件不同 ——
    // 正因如此「当时恰好合法」不能当作判据，必须逐个要求写出声明。
    const genericSlotted = slotted.filter((file) =>
      /generic\s*=\s*"[^"]*"/.test(readFileSync(file, "utf8")),
    );
    expect(
      genericSlotted.length,
      "没有扫到泛型且带 <slot> 的组件 —— 若 Volar 改了泛型组件的 emit 形态，这条会空跑",
    ).toBeGreaterThanOrEqual(5);
  });

  /**
   * 判据本身的可核对性：注释**不能**满足它（#188 评审 P1）。
   *
   * 上面那条逐组件断言声称守的是「删掉 `defineSlots` 调用会红」。这条把「注释里
   * 写着 `defineSlots`」这个真实形状单独喂进判据：源文件里**只有注释**、没有调用，
   * 断言必须为 false。做不到的话，上面那条在宏被删掉时照样绿 —— 它守的回归它自己拦不住。
   */
  it("只有注释提到 defineSlots 时，判据判为「未声明」", () => {
    const onlyComment = [
      "<script setup lang=\"ts\">",
      "/**",
      " * 刻意不写 defineSlots —— 这段注释里出现 defineSlots 这个词。",
      " * 按文本查找的判据会被它满足。",
      " */",
      "defineOptions({ name: \"OnlyComment\" });",
      "</script>",
      "<template><slot /></template>",
    ].join("\n");
    expect(onlyComment.includes("defineSlots"), "样本自身没提到 defineSlots，样本无效").toBe(true);
    expect(
      calledSetupMacros("OnlyComment.vue", onlyComment).has("defineSlots"),
      "注释里的 defineSlots 被当成了调用 —— 判据是文本查找而不是 AST",
    ).toBe(false);
  });

  it("真实调用能被判据认出（上一条的对照，避免判据恒假）", () => {
    const withCall = [
      "<script setup lang=\"ts\">",
      "defineSlots<{ default?(props: { a: number }): any }>();",
      "</script>",
      "<template><slot /></template>",
    ].join("\n");
    expect(calledSetupMacros("WithCall.vue", withCall).has("defineSlots")).toBe(true);
  });

  it("本仓库的组件确实同时满足两条（判据与现状没有脱节）", () => {
    // 「只有注释」那条用的是一个合成样本；这里确认真实组件走的是同一条路径 ——
    // 也就是「注释 + 调用」的混合形态被判为已声明。
    const mixed = [
      "<script setup lang=\"ts\">",
      "/** 解释为什么要 defineSlots 的注释。 */",
      "defineSlots<{ default?(): any }>();",
      "</script>",
      "<template><slot /></template>",
    ].join("\n");
    expect(calledSetupMacros("Mixed.vue", mixed).has("defineSlots")).toBe(true);
  });

  it("SFC 解析失败**抛错**而不是报成「缺 defineSlots」（fail-closed）", () => {
    // 解析失败时返回空集的话，上面那条逐组件断言会把原因报成「这个组件没有
    // defineSlots」—— 一个与真实原因无关的结论（假红），而门禁最忌讳这个。
    // 样本用**两个 `<template>`**：那是 SFC 层的硬错误（`@vue/compiler-sfc` 报
    // "can contain only one <template> element"），不会被「脚本能解析」蒙混过去。
    const broken = ["<template><slot /></template>", "<template><slot /></template>"].join("\n");
    expect(() => calledSetupMacros("Broken.vue", broken)).toThrow(/Broken\.vue/);
  });
});

describe("旧的「预期失败即通过」豁免已撤销", () => {
  it("check-api.mts 里不再有 KNOWN_BLOCKED 与那条探针", () => {
    const script = readFileSync(resolve(ROOT, "scripts/check-api.mts"), "utf8");
    // 探针的**失败方向**是「要求缺陷必须一直存在」。撤销豁免 = 这两处都不该再出现。
    //
    // 刻意剥掉注释再查：脚本的文件头**合法地**记述着这段历史（「#188 之前这里有两个
    // 名单（REPORTED 与 KNOWN_BLOCKED）」），按全文查会假红 —— 那是删除决策的
    // 依据，不是残留代码。
    const code = script
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(code, "KNOWN_BLOCKED 仍在：豁免没撤销").not.toContain("KNOWN_BLOCKED");
    expect(code, "probeKnownBlocked 仍在：仍在要求缺陷持续存在").not.toContain("probeKnownBlocked");
    expect(code, "KNOWN_BLOCKER_PATTERN 仍在").not.toContain("KNOWN_BLOCKER_PATTERN");
  });

  it("index / components 已进入 REPORTED 名单（走正常分析而不是探针）", () => {
    const boundary = readFileSync(resolve(ROOT, "scripts/api-forgotten-boundary.mts"), "utf8");
    const listed = /REPORTED_ENTRIES = \[([\s\S]*?)\] as const/.exec(boundary)?.[1] ?? "";
    for (const entry of ["index", "components"]) {
      expect(listed, `${entry} 不在 REPORTED_ENTRIES 里`).toContain(`"${entry}"`);
    }
  });

  it("「身份集合不适用」这个出口级豁免已删除（#188 评审 P1）", () => {
    // 出口级豁免等于在 index / components 上**关掉整层判据**：那里有 46 / 14 个
    // 本库真实类型待裁决，却因为「整个出口不适用」而不再被拒绝新增 —— #165 想堵住的
    // 洗基线路径在两个主出口上重新打开。改成「只按名字滤掉 Volar 机器名」。
    const boundary = readFileSync(resolve(ROOT, "scripts/api-forgotten-boundary.mts"), "utf8");
    const code = boundary
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(code, "FORGOTTEN_EXEMPT_ENTRIES 仍在：出口级豁免没撤销").not.toContain(
      "FORGOTTEN_EXEMPT_ENTRIES",
    );
    // 替代物必须在位：机器名过滤 + 零容忍名单。
    expect(code, "缺少 Volar 机器名过滤").toContain("VOLAR_MACHINE_NAME");
    expect(code, "缺少 publicForgottenExports 过滤函数").toContain("publicForgottenExports");
    expect(code, "缺少零容忍出口名单").toContain("FORGOTTEN_ZERO_TOLERANCE_ENTRIES");
  });

  it("机器名过滤只滤 __VLS_，本库真实类型一个都不放过", () => {
    // 判据的关键性质：过滤**精确到名字**。放宽成 `/^__/` 的话，本库恰好以双下划线
    // 开头的真实类型会被静默豁免 —— 那正是这道豁免当初要避免的「静默跳过」。
    expect(publicForgottenExports(["__VLS_Slots_3", "BMapError", "__VLS_component_2", "MapHandle"])).toEqual([
      "BMapError",
      "MapHandle",
    ]);
    // 双下划线但不是 Volar 机器名 ⇒ 不滤。
    expect(publicForgottenExports(["__Internal"])).toEqual(["__Internal"]);
    // 空集与全滤都不炸。
    expect(publicForgottenExports([])).toEqual([]);
    expect(publicForgottenExports(["__VLS_a"])).toEqual([]);
  });

  it("index / components 的真实欠账**仍被拒绝新增**（豁免没留下洗基线的口子）", () => {
    // 这是评审 P1 的核心：出口级豁免撤销后，这两个出口必须和其它出口同一把尺子。
    const indexBaseline = readForgotten("index");
    const componentsBaseline = readForgotten("components");
    expect(indexBaseline.length, "index 基线缺失或为空").toBeGreaterThan(0);
    expect(componentsBaseline.length, "components 基线缺失或为空").toBeGreaterThan(0);
    expect(
      newForbiddenForgottenExports("index", indexBaseline, [
        ...indexBaseline,
        "BrandNewInternalShape",
      ]),
      "index 上新增真实欠账没有被拒绝 —— 洗基线路径仍然敞开",
    ).toEqual(["BrandNewInternalShape"]);
    expect(
      newForbiddenForgottenExports("components", componentsBaseline, [
        ...componentsBaseline,
        "MarkerListProps_2",
      ]),
      "components 上新增真实欠账没有被拒绝",
    ).toEqual(["MarkerListProps_2"]);
  });

  it("两份基线里没有 Volar 机器名（过滤真的生效了）", () => {
    // 反向断言：机器名若出现在基线里，说明过滤没接上，146 个编译器临时名被登记进了
    // 公共 API 冻结表 —— 那正是取消豁免时要避免的。
    for (const entry of ["index", "components"]) {
      const names = readForgotten(entry);
      const machines = names.filter((name) => VOLAR_MACHINE_NAME.test(name));
      expect(machines, `${entry} 的基线里有 Volar 机器名：${machines.join(", ")}`).toEqual([]);
    }
  });

  it("**没有任何重建基线的入口**（评审 P1：删文件 + 重播种 = 洗基线）", () => {
    // 上一轮加过一��� `generate:api:seed-forgotten`，把「一次性」定义成「基线文件当前不存在」。
    // 那只证明**没有覆盖现存文件**，证明不了这是历史上的首次播种：删掉基线文件后重跑，
    // 会把「旧 46 个 + 本次新增的欠账」无条件写回去 —— 与 #165 要堵的那条路只差一步。
    // 首份基线已随本票提交（46 / 14），迁移完成后没有任何理由重建它，
    // 所以正确做法是**删掉这个入口**，而不是给它加条件。
    const script = readFileSync(resolve(ROOT, "scripts/check-api.mts"), "utf8");
    const code = script
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(code, "check-api.mts 里仍有播种模式 —— 删文件即可重播种").not.toContain("seedForgotten");
    expect(code, "--seed-forgotten 开关还在").not.toContain("--seed-forgotten");

    const boundary = readFileSync(resolve(ROOT, "scripts/api-forgotten-boundary.mts"), "utf8");
    const boundaryCode = boundary
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(boundaryCode, "seedableEntries 还在：可播种判定仍存在").not.toContain("seedableEntries");

    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(
      Object.keys(manifest.scripts).filter((k) => k.includes("seed")),
      "package.json 里还有 seed 脚本",
    ).toEqual([]);
  });

  it("基线文件缺失判失败，而不是读成空集（洗基线的根因）", () => {
    // 这才是根因：原先 `readForgottenBaseline` 对缺文件返回 `[]`，于是「删掉基线」
    // 与「基线确实为空」在判定上完全一样，任何把空集写回去的路径都等于洗掉欠账。
    const code = readFileSync(resolve(ROOT, "scripts/check-api.mts"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    // 判据按**行为**而不是按文本：缺文件那一支必须抛错。
    expect(
      code,
      "readForgottenBaseline 又按空集处理缺文件了 —— 删基线即可洗掉欠账",
    ).not.toMatch(/if \(!existsSync\(target\)\) return \[\]/);
    // 七个出口的基线都在（缺任何一个都会被上面那条判失败）。
    for (const entry of ["advanced", "composables", "plugins", "resolver", "ui-kit", "index", "components"]) {
      expect(existsSync(resolve(ROOT, `packages/bmap-vue/etc/${entry}/forgotten-exports.json`)),
        `${entry}: 身份集合基线缺失`).toBe(true);
    }
  });

  it("零容忍名单只覆盖存量已清零的出口，且登记了未清零出口的理由", () => {
    // index / components 今日有 46 / 14 个真实欠账待公共面裁决（属 #165 范围），
    // 列入零容忍等于要求 #188 顺手裁决公共 API 面。名单必须显式、且有理由。
    expect(FORGOTTEN_ZERO_TOLERANCE_ENTRIES).toContain("advanced");
    expect(FORGOTTEN_ZERO_TOLERANCE_ENTRIES).not.toContain("index");
    expect(FORGOTTEN_ZERO_TOLERANCE_ENTRIES).not.toContain("components");
    const boundary = readFileSync(resolve(ROOT, "scripts/api-forgotten-boundary.mts"), "utf8");
    // 理由写在常量的**文档注释**里（在声明之前），所以从常量名往后找找不到 ——
    // 判据取「常量声明之前那段注释」，且刻意匹配具体的欠账数字而不是泛泛的措辞。
    const docEnd = boundary.indexOf("export const FORGOTTEN_ZERO_TOLERANCE_ENTRIES");
    expect(docEnd, "找不到零容忍名单的声明").toBeGreaterThan(0);
    const doc = boundary.slice(0, docEnd);
    expect(doc, "零容忍名单没有说明 index / components 为何不在其中").toContain("46 / 14");
    expect(doc, "零容忍名单没有说明未清零欠账的处置归属").toContain("2026-09-25");
  });

  it("豁免出口仍会跑 AE、比对 report（豁免的只是身份集合那一层）", () => {
    const script = readFileSync(resolve(ROOT, "scripts/check-api.mts"), "utf8");
    // 豁免若把整个出口从 REPORTED 里摘掉，就退化成 #188 明确禁止的「静默跳过」。
    expect(script, "check:api 已不再对这些出口跑 AE").toContain("for (const entry of REPORTED)");
    expect(script, "豁免出口的 report 比对路径不见了").toContain("result.apiReportChanged");
  });
});