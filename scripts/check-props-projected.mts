#!/usr/bin/env node
/**
 * 「声明了却没有读者」的反向门禁（issue #177）
 *
 * ## 为什么要有这道脚本
 *
 * 仓库里已有的声明面门禁全部只覆盖**一个方向**：
 *
 * - `tests/behavior/overlay-suite.test.ts` 比对 `fields` 的键集与 `*Props` 的键集
 *   **双向相等**——但那一侧是「组件声明的每个 prop 都有落地方式」，
 *   对「`options()` 漏投影了某个已声明的 prop」**完全看不见**；
 * - `core/overlays/OverlaySpec.ts` 的 `OverlayFieldMap<Props>` 是 **mapped type**，
 *   漏一个键会**编译失败**——可 `Marker3D` / `MapMask` 走的是另一条路
 *   （`useOverlayResource` + 手写 `create`），那里**没有任何类型层约束**；
 * - `scripts/check-doc-props.mts` 扫的是**文档**与声明面是否一致，与运行时无关。
 *
 * 缺口因此是结构性的：`<LocationControl>.onLocationStart` 在 `LocationControlProps`
 * 里声明了、类型检查通过、Vue 正常接收，而 `options()` 根本没带这个键——于是它
 * **被静默丢弃**，且没有任何一道门禁会红。这正是 issue #177 要修的「假支持」。
 *
 * ## 判据（唯一一个）
 *
 * **对每个控件组件：`*Props` 接口里声明的每一个成员，都必须在该组件的 `options()`
 * 返回对象里被读一次。**
 *
 * 形式化一点：对控件 SFC 的 `<K>ControlProps` 与 `spec.options`，令
 * `D` = props 接口的成员键集（含它 `extends` 的基接口），`P` = `options()` 返回对象的键集，
 * 则要求 `D \ B ⊆ P`，其中 `B` 是 `ControlBaseProps` 的成员集（见下）。
 *
 * 方向很关键：`P \ D`（`options()` 带了但 props 没声明的键）是**允许**的
 * ——那是组件显式写出的常量/派生键，不在本门禁范围；本门禁只管
 * 「声明了却没人读」这一个方向。
 *
 * ### 唯一的例外：`ControlBaseProps` 的成员
 *
 * `ControlBaseProps`（`core/controls/spec.ts`）声明了 `anchor` / `offset` / `visible`。
 * 前两个走 `options()`，而 **`visible` 有自己的通道**——adapter 的 `applyVisible`
 * 单独读它（默认 SDK `show()` / `hide()`，可被 `spec.setVisible` 覆盖）。
 * 因此 `visible` 不进 `options()` 是**设计**，不是缺陷。
 *
 * 这个例外按**基接口成员**整体推导，不是硬编码某个名字：改 `ControlBaseProps`
 * 会自动改判据，而某个组件**自己**声明的 `visible` 之外的新键仍受门禁约束。
 *
 * ## 为什么不做成运行时断言
 *
 * `options()` 是一个返回普通对象的纯函数，可以直接调用；但 props 成员里有
 * 泛型与交叉类型，运行时读不到「`*Props` 声明了哪些键」。两侧都必须从
 * **AST** 取：props 侧取接口成员声明，`options()` 侧取对象字面量的属性名。
 * 两侧共用 `scripts/source-scan.mts` 的 SFC 解析层，避免第二份 `.vue` 提取实现
 * 与第一份漂移。
 *
 * ## 不做什么
 *
 * **不**检查「值最终会不会生效」——那要问的是 Driver（`planOptions` / 描述符），
 * 属于另一条已有门禁。本门禁只回答「这个 prop 有没有人读」。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ts from "typescript";
import { parse as parseSfc } from "vue/compiler-sfc";

const ROOT = resolve(import.meta.dirname, "..");
const CONTROLS_DIR = join(ROOT, "packages/bmap-vue/src/components/controls");
const OVERLAYS_DIR = join(ROOT, "packages/bmap-vue/src/components/overlays");
const CONTROL_SPEC_FILE = join(ROOT, "packages/bmap-vue/src/core/controls/spec.ts");
const SHARED_TYPES_FILE = join(ROOT, "packages/bmap-vue/src/types/components.ts");

export interface UnreadProp {
  /** 相对仓库根的组件文件名。 */
  readonly file: string;
  /** 组件名（`defineOptions({ name })`，缺省取文件名）。 */
  readonly component: string;
  /** 声明了却没被 `options()` 读到的 prop。 */
  readonly prop: string;
}

/** 一个文件里所有 `interface` 声明（名字 → 成员键 + 基接口名）。 */
function indexInterfaces(text: string): Map<string, { parents: string[]; keys: Set<string> }> {
  const source = ts.createSourceFile(
    "probe.ts",
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const interfaces = new Map<string, { parents: string[]; keys: Set<string> }>();
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    const parents = (statement.heritageClauses ?? [])
      .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((clause) => clause.types.map((type) => type.expression.getText(source)));
    const keys = new Set<string>();
    for (const member of statement.members) {
      // 只收属性声明：`foo(): void` 是方法（不是 prop），索引签名不具名（也不收）。
      if (ts.isPropertySignature(member)) {
        const propName = member.name;
        if (ts.isIdentifier(propName) || ts.isStringLiteral(propName)) keys.add(propName.text);
      }
    }
    interfaces.set(statement.name.text, { parents, keys });
  }
  return interfaces;
}

/**
 * 取一个 `interface`（含 `extends` 链）的全部成员键。
 *
 * `fallbackIndex` 让**跨文件**的基接口也能解析：`InfoWindowProps` 只是一个空壳，
 * 字段全部来自 `core/overlays/InfoWindowSpec` 的 `InfoWindowSpecProps`。
 * 查不到基接口就**不猜**（静默少收键会让门禁变松），而由调用方的非空守卫暴露出来。
 */
function readInterfaceKeys(
  text: string,
  name: string,
  fallbackIndex?: Map<string, { parents: string[]; keys: Set<string> }>,
): Set<string> {
  const local = indexInterfaces(text);
  const out = new Set<string>();
  const seen = new Set<string>();
  const collect = (interfaceName: string): void => {
    if (seen.has(interfaceName)) return;
    seen.add(interfaceName);
    // **名字会撞**：`core/overlays/InfoWindowSpec.ts` 与 `types/components.ts`
    // 各有一个 `InfoWindowProps`（后者只是 `extends` 前者的空壳）。因此同名时取
    // 成员更多的那一个——空壳会让整个门禁收不到键而显得「干净」。
    const localEntry = local.get(interfaceName);
    const fallbackEntry = fallbackIndex?.get(interfaceName);
    const entry =
      localEntry && fallbackEntry
        ? localEntry.keys.size >= fallbackEntry.keys.size
          ? localEntry
          : fallbackEntry
        : (localEntry ?? fallbackEntry);
    if (!entry) return;
    for (const key of entry.keys) out.add(key);
    for (const parent of entry.parents) collect(parent);
  };
  if (!local.has(name) && !fallbackIndex?.has(name)) {
    throw new Error(`找不到 interface ${name}`);
  }
  collect(name);
  return out;
}

/** 跨文件基接口的索引：`types/components.ts` + `core/overlays/InfoWindowSpec.ts`。 */
let sharedIndex: Map<string, { parents: string[]; keys: Set<string> }> | null = null;
function sharedInterfaces(): Map<string, { parents: string[]; keys: Set<string> }> {
  if (sharedIndex) return sharedIndex;
  sharedIndex = indexInterfaces(readFileSync(SHARED_TYPES_FILE, "utf8"));
  // `InfoWindowProps` 在两处**同名**：`types/components.ts` 里是 `extends` 出来的空壳，
  // 真正的字段在 `core/overlays/InfoWindowSpec.ts`。合并时取成员更多的那个——
  // 先到先得会让索引里留下空壳，于是门禁收不到任何键、显得「干净」。
  for (const extra of CROSS_FILE_BASE_INTERFACES) {
    for (const [name, entry] of indexInterfaces(readFileSync(extra.file, "utf8"))) {
      const existing = sharedIndex.get(name);
      if (!existing || entry.keys.size > existing.keys.size) sharedIndex.set(name, entry);
    }
  }
  return sharedIndex;
}

/** 已知的跨文件基接口来源。逐个登记，不递归扫全仓库——递归会命中几十个无关接口。 */
const CROSS_FILE_BASE_INTERFACES: ReadonlyArray<{ file: string }> = [
  { file: join(ROOT, "packages/bmap-vue/src/core/overlays/InfoWindowSpec.ts") },
];

/**
 * 走 `options()` **之外**的合法通道：当前只有 `ControlBaseProps` 的成员。
 *
 * 判据是「adapter 在别处读它」这一**事实**，因此从 `core/controls/spec.ts` 现场读出
 * 该基接口的成员，而不是在门禁里硬编码 `visible` 一个名字——改基接口会自动改判据。
 * 解析失败必须**硬失败**（不能退化成「没有例外」），否则判据会突然多管一个键而无人察觉。
 */
function readBasePropsKeys(): Set<string> {
  const keys = readInterfaceKeys(readFileSync(CONTROL_SPEC_FILE, "utf8"), "ControlBaseProps");
  if (keys.size < 2) {
    throw new Error(
      `ControlBaseProps 解析到 ${String(keys.size)} 个成员，解析方式可能已失效——` +
        "门禁不能在这种状态下继续（它会悄悄改变判据）。",
    );
  }
  return keys;
}

/** `spec.options` 箭头函数的**参数名**（组件侧习惯写 `p`）。 */
function readOptionsParam(source: ts.SourceFile): ts.Identifier | null {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "spec") continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      for (const property of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (property.name.getText(source) !== "options") continue;
        const arrow = property.initializer;
        return ts.isArrowFunction(arrow) ? arrow.parameters[0]?.name as ts.Identifier : null;
      }
    }
  }
  return null;
}

/**
 * `useOverlayResource` 组件的「有读者」集合：**整个 `<script setup>`** 里读到的 props 成员。
 *
 * 与控件不同：那里没有单一的 `options()` 可看——`create(ctx, p)` / `addToMap(res, ctx, p, scope)`
 * / `createWatchers(getCtx, getResource, p)` 三条路径都读 `p`，而 `visible` 在 `addToMap` 里
 * 走的是 `props.visible`（闭包直接引用 props 对象，不是 `p`）。因此这里扫全文，
 * 并同时接受 `p.X` 与 `props.X` 两种写法。
 *
 * 代价是判据比控件那侧松：某个键「只在别的钩子里被顺带读了一次」也算有读者。
 * 这是**刻意**的宽松——这一档缺的是「有没有读者」这个底线，不是「读者对不对」；
 * 读者对不对由 Driver 的描述符交叉核对与行为用例负责。
 */
function readAllPropReads(source: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const base = node.expression.text;
      // 组件里 props 对象的约定名是 `p`（钩子参数）与 `props`（`const props = withDefaults(...)`）。
      if (base === "p" || base === "props") out.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** `options()` 返回的对象字面量里**被读取**的属性名（`p.foo` → `foo`）。 */
function readProjectedKeys(source: ts.SourceFile, param: ts.Identifier): Set<string> {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === param.text
    ) {
      out.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  // 只扫 `options` 那个属性的初始化表达式，不扫整个文件——
  // 否则 `create` / `mount` / `events` 钩子里读的 `p.*` 会污染判据。
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "spec") continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      for (const property of declaration.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (property.name.getText(source) !== "options") continue;
        visit(property.initializer);
      }
    }
  }
  return out;
}

/**
 * 该 SFC 走的是**哪一种**声明架构（决定判据读哪一处）。
 *
 * | 架构 | 组件 | 已有保证 | 本门禁的增量 |
 * | --- | --- | --- | --- |
 * | `ControlSpec` | 全部 11 个控件 | 无（`options(props): ControlOptions` 返回 `Record`，不具名） | **全部**——这就是 `onLocationStart` 漏掉的那条 |
 * | `useOverlaySpec` | 9 个覆盖物 | `OverlayFieldMap<Props>` 是 mapped type，漏一个键**编译失败** | 零（类型层已完备） |
 * | `useOverlayResource` | `Marker3D` / `MapMask` | **无**——`create(ctx, p)` 第二个参数是普通 `Props`，没有任何东西强制它被读完 | **全部** |
 *
 * 判据是**实测**源码里出现的是哪个 composable，而不是一张文件名表：新增组件会自动落到正确的那一档。
 */
type Arch =
  | "control-spec"
  | "overlay-spec"
  | "overlay-resource"
  /** 生命周期在**别的 composable** 里（`useContextMenu` / `useInfoWindow` / …）。 */
  | "external-composable"
  /** 既没有 `*Props` 也没有任何 props（纯展示 / 纯结构组件）。 */
  | "no-props"
  | "unknown";

/**
 * 判据**判不了**的组件：读者不在 SFC 里，而在另一个 composable 文件中。
 *
 * 逐条列出来而不是放宽成「扫描面之外的一律放行」——那正是本门禁要消灭的那种
 * 「判据看不见所以当它没问题」。每个名字都记着读者在哪，读者一旦消失，
 * 这里就要跟着改（新增走别的 composable 的组件会被判成 `unknown` 而硬失败，
 * 逼着人把它登记进来或接上三条架构之一）。
 */
const EXTERNAL_COMPOSABLE_COMPONENTS: Readonly<Record<string, string>> = {
  ContextMenu: "core/composables/useContextMenu.ts",
  InfoWindow: "core/composables/useInfoWindow.ts",
  CustomOverlay: "core/composables/useOverlaySpec.ts（经 createCustomOverlaySpec）",
  MenuItem: "core/composables/useContextMenu.ts（经 context/menu.ts 归一）",
};

function readArch(source: ts.SourceFile): Arch {
  // composable 可能出现在两种位置：裸语句 `useControlResource(props, spec);`
  // （十个控件都是这种），或解构赋值 `const { x } = useOverlaySpec(props, spec)`。
  // 统一按「全文找调用表达式」处理，避免漏掉其中一种而把正常组件判成 unknown。
  let arch: Arch = "unknown";
  const visit = (node: ts.Node): void => {
    if (arch !== "unknown") return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (callee === "useControlResource") arch = "control-spec";
      else if (callee === "useOverlaySpec") arch = "overlay-spec";
      else if (callee === "useOverlayResource") arch = "overlay-resource";
      // 其余 `useXxx(...)`：读者不在本 SFC 里，交给登记表逐条认定。
      else if (/^use[A-Z]/.test(callee) && !callee.startsWith("useMarkerIcons")) {
        arch = "external-composable";
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return arch;
}

/** 组件名：优先 `defineOptions({ name: "X" })`，缺省用文件名。 */
function readComponentName(source: ts.SourceFile, fallback: string): string {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    if (!ts.isCallExpression(statement.expression)) continue;
    if (statement.expression.expression.getText(source) !== "defineOptions") continue;
    const arg = statement.expression.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) continue;
    for (const property of arg.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      if (property.name.getText(source) === "name" && ts.isStringLiteral(property.initializer)) {
        return property.initializer.text;
      }
    }
  }
  return fallback;
}

function probeFile(file: string, baseProps: Set<string>): UnreadProp[] | { error: string } {
  return probeText(file.replace(`${ROOT}/`, ""), readFileSync(file, "utf8"), baseProps);
}

/** 判据本体：只吃源码文本，不碰文件系统（因此可被自测用合成源码驱动）。 */
function probeText(rel: string, text: string, baseProps: Set<string>): UnreadProp[] | { error: string } {
  const { descriptor, errors } = parseSfc(text, { filename: `${rel}.vue` });
  if (errors.length > 0 || !descriptor?.scriptSetup) {
    return { error: `${rel}: SFC 解析失败（${errors.map((e) => e.message).join("; ") || "无 scriptSetup"}）` };
  }
  const block = descriptor.scriptSetup.content;
  const source = ts.createSourceFile(
    "probe.ts",
    block,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  // 接口名按「文件名 + Props」推断；找不到就由调用方决定是否跳过。
  const base = rel.split("/").pop()!.replace(/\.vue$/, "");
  const interfaceName = `${base}Props`;
  const component = readComponentName(source, base);
  const arch = readArch(source);

  // 既没有 `*Props` 也没有 props 的纯结构组件（`<MenuSeparator>`）——无 prop 可判。
  // 判据是「没有 `defineProps` 调用」，不是「接口查不到」，否则一个真的漏导出
  // 组件 props 的情况会被当成纯结构组件放过去。
  if (!/defineProps\s*(<|\()/.test(block)) return [];

  // `*Props` 有两个落点：控件与少数覆盖物把接口**自持在 SFC 里**，其余集中在
  // `types/components.ts`（那是「公共类型自持」的口径）。两处都试，找不到才算解析失败。
  let declared: Set<string>;
  try {
    declared = readInterfaceKeys(block, interfaceName, sharedInterfaces());
  } catch {
    try {
      declared = readInterfaceKeys(
        readFileSync(SHARED_TYPES_FILE, "utf8"),
        interfaceName,
        sharedInterfaces(),
      );
    } catch (error) {
      return { error: `${rel}: ${(error as Error).message}（SFC 与 types/components.ts 都没有）` };
    }
  }
  // 解析守卫：解析器失效时必须红，而不是让「两个空集合相等」通过。
  if (declared.size < 3) {
    return { error: `${rel}: ${interfaceName} 解析到 ${String(declared.size)} 个成员，解析方式可能已失效` };
  }

  // `useOverlaySpec` 那一档由 `OverlayFieldMap<Props>`（mapped type）在**类型层**强制完备，
  // 漏一个键 `vue-tsc` 就红。这道门禁不重复它，也不假装能查出一个编译期已经拦住的缺陷。
  if (arch === "overlay-spec") return [];

  // 读者在别的 composable 里：判据在本 SFC 上**判不了**，因此必须逐条登记。
  // 没登记就是「判据看不见」——那正是本门禁要消灭的状态，不能默认放行。
  if (arch === "external-composable") {
    const reader = EXTERNAL_COMPOSABLE_COMPONENTS[component];
    if (!reader) {
      return {
        error:
          `${rel}: <${component}> 走外部 composable 声明，但不在 \`EXTERNAL_COMPOSABLE_COMPONENTS\` 登记表里——` +
          "请登记它的读者在哪，或把组件改接 useOverlaySpec（那样类型层就会替你把关）",
      };
    }
    void reader;
    return [];
  }

  let read: Set<string>;
  if (arch === "control-spec") {
    const param = readOptionsParam(source);
    if (!param) return { error: `${rel}: 找不到 \`spec.options\` 的箭头函数参数` };
    read = readProjectedKeys(source, param);
    if (read.size === 0) {
      return { error: `${rel}: \`options()\` 解析到 0 个被读取的属性，解析方式可能已失效` };
    }
  } else if (arch === "overlay-resource") {
    read = readAllPropReads(source);
    if (read.size === 0) {
      return { error: `${rel}: 解析到 0 个 props 读取点，解析方式可能已失效` };
    }
  } else {
    return {
      error:
        `${rel}: 认不出它走哪条声明架构（useControlResource / useOverlaySpec / useOverlayResource 都不是）——` +
        "新增组件请接其中一条，否则「声明了却没人读」又变成无人能查的盲区",
    };
  }

  return [...declared]
    // 基接口成员各有自己的通道（`visible` → `applyVisible`），不是「没人读」。
    .filter((prop) => !(arch === "control-spec" && baseProps.has(prop)))
    .filter((prop) => !read.has(prop))
    .map((prop) => ({ file: rel, component, prop }))
    .sort((a, b) => a.prop.localeCompare(b.prop));
}

function listVue(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".vue")) acc.push(join(dir, entry));
  }
  return acc;
}

/**
 * 判据本体：**纯函数**，输入是一组「文件名 → 源码」与基接口成员集。
 *
 * 做成纯函数是为了让自测能直接喂**合成源码**（`--self-test` 模式），
 * 而不是去改磁盘上的真组件——改真文件会让并行的其它测试文件读到半个组件，
 * 实测确实把 `controls.test.ts` 的一条「控件总数」断言带崩了。
 */
export function auditSources(
  sources: ReadonlyArray<{ readonly rel: string; readonly text: string }>,
  baseProps: ReadonlySet<string>,
): { readonly unread: UnreadProp[]; readonly problems: string[] } {
  const unread: UnreadProp[] = [];
  const problems: string[] = [];
  for (const { rel, text } of sources) {
    const result = probeText(rel, text, baseProps);
    if ("error" in result) problems.push(result.error);
    else unread.push(...result);
  }
  return { unread, problems };
}

function main(): number {
  const files = [...listVue(CONTROLS_DIR), ...listVue(OVERLAYS_DIR)];
  if (files.length === 0) {
    console.error("check-props-projected FAILED: 控件 / 覆盖物目录里一个 .vue 都没有，扫描范围配错了。");
    return 1;
  }

  let baseProps: Set<string>;
  try {
    baseProps = readBasePropsKeys();
  } catch (error) {
    console.error(`check-props-projected FAILED: ${(error as Error).message}`);
    return 1;
  }
  const { unread, problems } = auditSources(
    files.map((file) => ({ rel: file, text: readFileSync(file, "utf8") })),
    baseProps,
  );

  if (problems.length > 0 || unread.length > 0) {
    console.error(
      `check-props-projected FAILED: ${unread.length} 个「声明了却没人读」的 prop（已扫 ${files.length} 个组件）。`,
    );
    for (const p of unread) {
      console.error(`  ${p.file}  <${p.component} :${p.prop}>`);
    }
    for (const p of problems) console.error(`  [解析失败] ${p}`);
    console.error(
      "判据：组件 `*Props` 里声明的每个成员，都必须有读者——控件走 `options()` 的投影，" +
        "手写 adapter 的覆盖物走 `create` / `addToMap` / `createWatchers` 里的 `p.*`。" +
        "否则它就是「类型检查通过、Vue 正常接收、然后被静默丢弃」的假支持。",
    );
    return 1;
  }
  console.log(
    `check-props-projected OK: 已扫 ${files.length} 个组件，每个声明 prop 都真的有读者。`,
  );
  return 0;
}

process.exitCode = main();
