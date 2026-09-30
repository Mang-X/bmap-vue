#!/usr/bin/env node
/**
 * 交互开关 prop 的「未传」可达性门禁（issue #179）
 *
 * ## 这道门禁在防什么
 *
 * `<Map>` 的 `syncEnableProps` 用 `!== undefined` 表达「**不表态**，交给 SDK 用它自己声明的
 * 默认值」：
 *
 * ```ts
 * for (const [prop, interaction] of INTERACTION_PROPS) {
 *   const value = props[prop];
 *   if (value === undefined) continue;              // ← 只有在「未传」真能到达时才成立
 *   ctx.client.driver.map.setInteraction(ctx.map, interaction, Boolean(value));
 * }
 * ```
 *
 * 但 Vue 会把**缺省 `Boolean` prop** 的「没传」强转成 `false`（`resolvePropValue` 里
 * `shouldCast && isAbsent && !hasDefault ⇒ false`）。于是一个交互 prop 只要**没在 `withDefaults`
 * 里显式出现**，`value === undefined` 这个守卫对它就**永不命中**，每次建图都会被逐个
 * `disable*()`——官方 `core/MapOptions.d.ts` 声明 `@default true` 的
 * `enableDblclickZoom` / `enablePinchZoom` 就这样被静默关掉了（用户什么都不写，
 * 双指缩放与双击缩放消失）。#179 修了当时那六项，但**没有**任何门禁阻止第七项重蹈覆辙。
 *
 * ## 判据
 *
 * **`INTERACTION_PROPS` 覆盖的每一个 prop 名，都必须在同一文件 `withDefaults(...)` 的
 * 第二个参数（defaults 对象字面量）里作为一个属性名出现。**
 *
 * 刻意**不**校验值的语义（`undefined` / `true` / `false` 都合法）：三者都让 `hasDefault`
 * 为真、都关掉了 Vue 的「缺失即 `false`」转换，而**选哪个值是决策**，不是门禁该管的事。
 * 门禁只保证**「未传」这个状态可达**，所以判据落在**存在性**上。
 *
 * ## 为什么是「存在」而不是「值必须等于 undefined」
 *
 * 若要求六项必须是 `undefined`，判据就退化成常量（`enableDragging: true` /
 * `enableWheelZoom: false` 立刻把它顶红），而这两项是**有意**偏离官方的决策
 * （见 `Map.vue` 的 `withDefaults` 注释）。「新增交互 prop 时忘了写进 `withDefaults`」
 * 才是本门禁要拦的失效模式，值本身不是。
 *
 * ## 两种模式
 *
 * - （无参数）扫 `packages/bmap-vue/src/components/map/Map.vue`。
 * - `--file <path>`：扫指定文件（门禁自测用它造正反例——`--dir` 那套见 `check-docs-links`）。
 *
 * ## fail-closed
 *
 * 解析不到 `INTERACTION_PROPS`（改名 / 换写法）、解析不到 `withDefaults` 的 defaults 实参，
 * 或表里解析出 0 个 prop 名时**一律判失败**，绝不静默放行——放行等于门禁空转，而且
 * 「扫到 0 个」与「真的干净」在日志上必须长得不一样。
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { scanSourceFile, type ScannableViolation, type SourceVisitor } from "./source-scan.mts";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_TARGET = join(ROOT, "packages/bmap-vue/src/components/map/Map.vue");

/**
 * 本门禁从一份源码里抽出的两份名单。
 *
 * 字段**刻意不 readonly**：`Map.vue` 有 `<script>` 与 `<script setup>` 两个区块，
 * `scanSourceFile` 会各调一次 visitor，结果要**累积**进同一份结构。
 */
interface InteractionDefaults {
  /** `INTERACTION_PROPS` 里逐项的 prop 名（按出现顺序）。 */
  interactionProps: string[];
  /** `withDefaults` 的 defaults 对象里出现过的属性名。 */
  defaultKeys: Set<string>;
  /** 是否真的找到了 `INTERACTION_PROPS` 这个声明。 */
  sawTable: boolean;
  /** 是否真的找到了 `withDefaults(defineProps(...), <第二个实参>)`。 */
  sawDefaults: boolean;
}

/** 新建一份空的采集结果。 */
function emptyFindings(): InteractionDefaults {
  return { interactionProps: [], defaultKeys: new Set<string>(), sawTable: false, sawDefaults: false };
}

/** 把一次区块解析的结果并进累积结构。 */
function mergeFindings(into: InteractionDefaults, part: InteractionDefaults): void {
  into.interactionProps.push(...part.interactionProps);
  for (const key of part.defaultKeys) into.defaultKeys.add(key);
  into.sawTable ||= part.sawTable;
  into.sawDefaults ||= part.sawDefaults;
}

/**
 * 从一段 TS 源码里抽出本门禁要的两份名单。
 *
 * **刻意不导出**：抽取器靠 `tests/behavior/interaction-props-gate.test.ts` 的**正反例**
 * 覆盖（少一项就红、改名就 fail-closed、真实面必须扫到 8 项），不是靠外部直接调它——
 * 没有第二个消费者就不留导出面（`check-docs-links` 的 `slugify` 有自测直接调用才导出）。
 */
function collectInteractionDefaults(astText: string, kind: ts.ScriptKind): InteractionDefaults {
  const source = ts.createSourceFile("map.vue.ts", astText, ts.ScriptTarget.Latest, true, kind);
  const found = emptyFindings();

  const visit = (node: ts.Node): void => {
    // `withDefaults(defineProps<...>(), { ... })` —— 第二个实参才是 defaults。
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "withDefaults") {
      const defaults = node.arguments[1];
      // 只要**出现了**第二个实参就算找到：即便它不是对象字面量，也由下面的
      // 「解析到零个属性名」那条独立报错，而不是被静默当成一张空表放行。
      if (defaults) {
        found.sawDefaults = true;
        if (ts.isObjectLiteralExpression(defaults)) {
          for (const prop of defaults.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              found.defaultKeys.add(prop.name.text);
            } else if (ts.isShorthandPropertyAssignment(prop)) {
              found.defaultKeys.add(prop.name.text);
            }
          }
        }
      }
    }

    // `const INTERACTION_PROPS: Array<[keyof MapProps, MapInteraction]> = [ ... ]`
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      if (node.name.text === "INTERACTION_PROPS") {
        found.sawTable = true;
        for (const element of node.initializer.elements) {
          // `[propName, interactionName]` 元组：只取第 0 项的字符串字面量。
          if (!ts.isArrayLiteralExpression(element) || element.elements.length === 0) continue;
          const first = element.elements[0]!;
          if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
            found.interactionProps.push(first.text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** 一个漏声明的交互 prop，以及它在 `withDefaults` 块里的定位。 */
interface MissingDefault {
  readonly prop: string;
  /** 1 基行号：`withDefaults(` 那一行（props 已在那里时取 props 自己的行号）。 */
  readonly line: number;
}

/** 目标文件在仓库根下的报告用路径。 */
function relOf(file: string): string {
  return relative(ROOT, file) || file;
}

/** 跑一个相位，返回退出码。 */
function runPhase(file: string): number {
  const rel = relOf(file);
  // 只借 `scanSourceFile` 的 **SFC 提取层**（`.vue` 要先用 `vue/compiler-sfc` 抽出脚本区块
  // ——与 `check-raw-sdk` 同一个解析器，第二份实现迟早与它漂移）。
  // 刻意**不消费**它的 `violations` 输出：本门禁的产物是「一份缺失 prop 名单」，
  // 不是可按 rule 聚合的违规表，硬套那套字段只会造出一个写了从不读的空数组。
  // 解析失败经 `failures` 带回（必须当失败，绝不静默放行）。
  const failures: string[] = [];
  const found = emptyFindings();

  const visitor: SourceVisitor<ScannableViolation> = (_f, astText, _locationText, _offset, _out, kind) => {
    mergeFindings(found, collectInteractionDefaults(astText, kind));
  };

  scanSourceFile(rel, readFileSync(file, "utf8"), [], failures, visitor);

  // ---- fail-closed：判据本身必须真的取到了东西 ----
  if (failures.length > 0) {
    console.error(`check-interaction-props FAILED: ${rel} 解析失败：`);
    for (const f of failures) console.error(`  ${f}`);
    return 1;
  }
  if (!found.sawTable) {
    console.error(
      `check-interaction-props FAILED: ${rel} 里没有找到 INTERACTION_PROPS 的数组字面量声明。` +
        "改名 / 换写法之后这道门禁就空转了——请同步更新 scripts/check-interaction-props.mts。",
    );
    return 1;
  }
  if (!found.sawDefaults) {
    console.error(`check-interaction-props FAILED: ${rel} 里没有找到 withDefaults 的 defaults 实参。`);
    return 1;
  }
  if (found.interactionProps.length === 0) {
    console.error(
      "check-interaction-props FAILED: INTERACTION_PROPS 解析出 0 个 prop 名——判据空转，不放行。",
    );
    return 1;
  }

  // ---- 判据：逐项必须出现在 withDefaults 里 ----
  const text = readFileSync(file, "utf8").split("\n");
  const withDefaultsLine = text.findIndex((l) => l.includes("withDefaults(")) + 1;
  const missing: MissingDefault[] = [];
  for (const prop of found.interactionProps) {
    if (found.defaultKeys.has(prop)) continue;
    // 定位到 defaults 块所在行：出错的 prop 本来就不在块里，只能指到块头。
    const idx = text.findIndex((l) => new RegExp(`^\\s*${prop}\\s*:`).test(l));
    missing.push({ prop, line: idx >= 0 ? idx + 1 : withDefaultsLine });
  }

  if (missing.length > 0) {
    console.error(
      `check-interaction-props FAILED: ${rel} 里 ${missing.length}/${found.interactionProps.length} 个交互开关 prop ` +
        "没有出现在 withDefaults 里（判据来自 INTERACTION_PROPS 的第一列）：" +
        missing.map((m) => m.prop).join(" / "),
    );
    for (const m of missing) console.error(`  ${rel}:${m.line}  ${m.prop}`);
    console.error(
      "\n为什么不写就等于「关掉」：Vue 会把**缺省 Boolean prop** 的「没传」强转成 false，\n" +
        "而 syncEnableProps 靠 `!== undefined` 表达「不表态」——没在 withDefaults 里出现，\n" +
        "这个守卫对它永不命中，每次建图都会被逐个 disable*()，官方 `@default true` 的\n" +
        "enableDblclickZoom / enablePinchZoom 会被静默关掉（issue #179）。\n" +
        "\n修法：在 withDefaults 的第二个参数里补上这个属性名——值写实际默认（`true` / `false`），\n" +
        "或写 `undefined` 表示「不表态，交给 SDK 用它自己声明的默认值」。两者都能关掉\n" +
        "Vue 的「缺失即 false」转换。",
    );
    return 1;
  }

  console.log(
    `check-interaction-props OK: ${rel} —— INTERACTION_PROPS 的 ${found.interactionProps.length} 个 prop ` +
      `（${found.interactionProps.join(" / ")}）全部在 withDefaults 里显式声明。`,
  );
  return 0;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes("--file")) {
    const file = args[args.indexOf("--file") + 1];
    if (!file) {
      console.error("check-interaction-props: --file 需要一个路径参数。");
      return 2;
    }
    return runPhase(resolve(file));
  }
  return runPhase(DEFAULT_TARGET);
}

process.exitCode = main();
