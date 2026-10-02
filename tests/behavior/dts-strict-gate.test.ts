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
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const MANIFEST = JSON.parse(
  readFileSync(resolve(ROOT, "packages/bmap-vue/package.json"), "utf8"),
) as { exports: Record<string, unknown> };

/** 消费方的子路径（`package.json#exports` 的键去掉 `./`，去掉纯 types 的 `./volar` 与 meta）。 */
const SUBPATHS = Object.keys(MANIFEST.exports)
  .filter((key) => key !== "./volar" && key !== "./package.json")
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
    expect(probe, "探针没有断言 $slots 可取用").toMatch(/InstanceType<typeof \w+>\["\$slots"\]/);
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
  it("package.json#exports 的每个子路径都被探针 import 了", () => {
    const probe = readFileSync(resolve(ROOT, "fixtures/consumer/strict/probe.ts"), "utf8");
    const missing = SUBPATHS.filter(
      (subpath) => !new RegExp(`from\\s*["']${subpath.replace(/\//g, "\\/")}["']`).test(probe),
    );
    expect(
      missing,
      `这些出口在 exports 里存在但探针没 import ⇒ 它们的声明没人验：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("出口名单非空（判据没有着力点时上面那条会恒真）", () => {
    expect(SUBPATHS.length).toBeGreaterThanOrEqual(7);
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
  )("%s 声明了 defineSlots", (_label, file) => {
    const source = readFileSync(file, "utf8");
    expect(
      source.includes("defineSlots"),
      `${file.replace(ROOT + "/", "")} 模板里有 <slot> 却没有 defineSlots —— ` +
        `vue-tsc 会把载荷 emit 成模块局部的 \`declare var __VLS_N\`，` +
        `而声明打包阶段只保留导出面可达的符号，那条声明连同其声明一起消失，` +
        `留下悬空引用（#188）。`,
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

  it("「身份集合不适用」是显式登记且带理由的，不是静默跳过", () => {
    const boundary = readFileSync(resolve(ROOT, "scripts/api-forgotten-boundary.mts"), "utf8");
    expect(boundary).toContain("FORGOTTEN_EXEMPT_ENTRIES");
    // 逐出口带理由：合写成一句就变成「适用于所有出口的通用借口」，等于没有理由。
    for (const entry of ["index", "components"]) {
      expect(boundary, `${entry} 没有登记不适用理由`).toMatch(
        new RegExp(`${entry}:\\s*\\{[\\s\\S]{0,80}?reason:`),
      );
    }
  });

  it("豁免出口仍会跑 AE、比对 report（豁免的只是身份集合那一层）", () => {
    const script = readFileSync(resolve(ROOT, "scripts/check-api.mts"), "utf8");
    // 豁免若把整个出口从 REPORTED 里摘掉，就退化成 #188 明确禁止的「静默跳过」。
    expect(script, "check:api 已不再对这些出口跑 AE").toContain("for (const entry of REPORTED)");
    expect(script, "豁免出口的 report 比对路径不见了").toContain("result.apiReportChanged");
  });
});