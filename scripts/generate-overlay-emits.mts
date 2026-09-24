#!/usr/bin/env node
/**
 * #138: 由覆盖物事件事实源生成 `defineEmits` 的**显式键 interface**
 *
 * 生成物：`packages/bmap-vue/src/core/overlays/overlayEventEmits.generated.ts`
 *
 * ## 为什么要有这一步
 *
 * 迁移到 `OverlaySpec` 之后，运行时的事件面（`core/overlays/overlayEventCatalog.ts` 的矩阵）
 * 已经是单一事实源，但每个 SFC 仍要**手抄**一遍 `defineEmits<{ … }>()`：那是运行时订阅管不到的
 * 那一半——它只影响**类型面**（模板里 `@click` 的参数类型、`$emit` 的重载、Volar 补全）。
 * 「Catalog 一份 + 手抄一份」意味着矩阵加一个事件，12 个组件里谁忘了改，只能靠一条事后刮源码的
 * 测试兜底。改成生成：那一步从「记得改 12 处」变成「跑一条命令」。
 *
 * ## 为什么生成物是**显式键 interface**，不是 mapped type
 *
 * `@vue/compiler-sfc` 必须把 `defineEmits` 的类型实参解析成「有限个键」。`core/events/eventCatalog.ts`
 * 的 `MapEventEmits` 上那张表已经把这个约束钉死（`@vue/compiler-sfc@3.5.42` 实测）：
 * `{ [K in keyof typeof CATALOG]: … }` 报 `Failed to resolve index type into finite keys`，
 * 值里含条件类型同样报错。**只有 import 进来的显式键 interface 能编过。**
 *
 * ## 两处事实源
 *
 * | 事实源 | 内容 |
 * | --- | --- |
 * | `core/overlays/overlayEventCatalog.ts` 的 `OVERLAY_EVENT_MATRIX` | 每个 kind 的 SDK 事件 + 载荷档 |
 * | 本文件的 `NON_SDK_EVENTS` | **不是** SDK 事件的本库事件（v-model 回写 / 生命周期 / 菜单选中） |
 *
 * 1.0 之前这里还有第三处——集中弃用层登记的**历史事件别名**（marker 的 `drag-end`）。集中弃用层
 * 已随 #136 整层删除，1.0 不提供旧版迁移路径，别名**不再出现在任何 emits 声明里**
 * （#154 并入了本生成器；删别名时必须同提交改这里，否则 `--check` 会把旧键留在产物中）。
 *
 * ## 两道防漂移
 *
 * ① **派发核对**：`NON_SDK_EVENTS` 登记的每个名字，回源码里确认真的有人 `emit` 它。声明了却没人发，
 *    Vue 不会报错——那是最坏的一类漂移。
 * ② **SFC 核对**：每个 kind 的 SFC 必须 `import` 本产物的 interface 并把它用作 `defineEmits` 的
 *    泛型实参。类型层看不到 SFC 的实参，只能查文本；这是文本检查，如实说明见 ADR #138 决策 ⑥。
 *
 * 用法：
 *   node --experimental-strip-types scripts/generate-overlay-emits.mts
 *   node --experimental-strip-types scripts/generate-overlay-emits.mts --check
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSourceModule } from "./load-source-module.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  root,
  "packages/bmap-vue/src/core/overlays/overlayEventEmits.generated.ts",
);

type PayloadKind = "pointer" | "partial-pointer" | "base";

interface OverlayEventDefinition {
  readonly sdk: string;
  readonly vue: string;
  readonly payload: PayloadKind;
}

interface EventMatrixEntry {
  readonly events: Readonly<Record<string, OverlayEventDefinition>>;
}

interface NonSdkEvent {
  /** 派发点（相对 `packages/bmap-vue/src`），生成器回源码核对它真的 `emit` 了这个名字。 */
  readonly origin: string;
  /** 载荷类型；`undefined` = 不带载荷（`()[]` 形式）。 */
  readonly payload?: string;
}

const { OVERLAY_EVENT_MATRIX } = await loadSourceModule<{
  OVERLAY_EVENT_MATRIX: Record<string, EventMatrixEntry>;
}>(resolve(root, "packages/bmap-vue/src/core/overlays/overlayEventCatalog.ts"));

/** 载荷档 → 载荷类型（与 `driver/types/events.ts` 的三个载荷类型一一对应）。 */
const PAYLOAD_TYPE_BY_KIND: Record<PayloadKind, string> = {
  pointer: "OverlayPointerEvent",
  "partial-pointer": "OverlayPartialPointerEvent",
  base: "OverlayEventPayload",
};

/**
 * 逐 kind 覆写：矩阵的 `payload` 描述的是「按矩阵绑定的订阅」拿到的载荷形状，而个别组件的
 * 转发路径**不经过那层归一化**——此时按档声明就是在说谎。
 *
 * 目前只有 `info-window` 需要覆写，原因具体到每一条：`<InfoWindow>` 不走 `useOverlaySpec`
 * （它有自己的每图 ownership 管理器，见 `core/composables/useInfoWindow.ts`），
 * `FORWARDED_SDK_EVENTS` 是**原样转发**上游回调参数：
 *
 * - `open` / `close`：**不带**载荷（上游这两个事件不给事件对象，转发时就是 `emit("open")`），
 *   按 `base` 档声明成 `[event: OverlayEventPayload]` 会凭空造一个参数。
 * - `clickclose` / `maximize` / `restore`：转发的是**未经归一化**的上游事件对象，其类型在上游
 *   类型包里没有对应的公共别名，调用方现在按 `unknown` 收——照抄现状，而不是把它说成
 *   一个更具体的类型。
 *
 * 换句话说：这里不是「特殊情况」，而是「**不假装有归一化**」。要改口径，先改
 * `useInfoWindow` 的转发（加归一化），再删这里的覆写。
 */
const PAYLOAD_OVERRIDES_BY_KIND: Record<string, Record<string, string | undefined>> = {
  "info-window": {
    open: undefined,
    close: undefined,
    clickclose: "unknown",
    maximize: "unknown",
    restore: "unknown",
  },
};

/**
 * 矩阵里有、但本库**没有派发点**的键（显式排除，逐条写明理由）。
 *
 * 为什么必须显式登记而不能默默少一个：SFC 的 `defineEmits` 是「模板上能绑哪些事件」的唯一
 * 契约。少了 `resize`，用户写 `@resize` 时 vue-tsc 会报「未知事件」——这是**好事**
 * （早期、显式），比声明一个永不触发的事件（Vue 不报错、模板能绑、运行时静默）好得多。
 * 但「为什么少」必须留痕，否则下一个维护者只会看到矩阵和 emits 对不上。
 */
const EXCLUDED_EVENTS: Record<string, Record<string, string>> = {
  "info-window": {
    resize:
      "官方 `InfoWindowEventMap` 声明了它，但气泡尺寸由 `width` / `height` prop 经 `setContent` " +
      "重绘驱动；官方 `resize` 在本库只被观察、不驱动任何状态，因此没有派发点，也不进声明。",
  },
};

/**
 * 矩阵事件在生成物里逐条写注释时的措辞（同一段，避免每处手写）。
 *
 * `requiresEditing` 的编辑事件额外点一句：它们只在 `enableEditing()` 之后才派发
 * （见 `overlayEventCatalog.ts` 的「编辑事件」一节），调用方漏开开关会以为事件坏了。
 */
const EDITING_HINT =
  "上游文档：需先调用 `enableEditing()`；未开启时不会派发。";

/** 载荷按覆写表取值时追加的后缀（矩阵档与真实转发路径不一致的键）。 */
const FORWARDED_HINT = "（载荷按转发路径的真实形状声明，不按矩阵的档。）";

function commentFor(kind: string, name: string): string {
  const definition = OVERLAY_EVENT_MATRIX[kind]!.events[name]!;
  const parts = [definition.description];
  if (definition.requiresEditing) parts.push(EDITING_HINT);
  return parts.join(" ");
}

/** 本库（非 SDK）事件：v-model 回写、生命周期、菜单选中。 */
const NON_SDK_EVENTS: Record<string, Record<string, NonSdkEvent>> = {
  marker: {
    "update:position": { origin: "components/overlays/markerSpec.ts", payload: "Point" },
  },
  "info-window": {
    "update:open": { origin: "core/composables/useInfoWindow.ts", payload: "boolean" },
    rebuild: { origin: "core/composables/useInfoWindow.ts", payload: "number" },
    destroy: { origin: "core/composables/useInfoWindow.ts", payload: "number" },
  },
  "context-menu": {
    select: { origin: "core/composables/useContextMenu.ts", payload: "ContextMenuSelectPayload" },
  },
};

/** kind → SFC 文件名（`assertSfcUsesGenerated` 用它把「SFC 用了生成类型」也钉成会红的一条）。 */
const SFC_BY_KIND: Record<string, string> = {
  marker: "Marker.vue",
  label: "Label.vue",
  polyline: "Polyline.vue",
  polygon: "Polygon.vue",
  rectangle: "Rectangle.vue",
  circle: "Circle.vue",
  prism: "Prism.vue",
  "bezier-curve": "BezierCurve.vue",
  "ground-overlay": "GroundOverlay.vue",
  "custom-overlay": "CustomOverlay.vue",
  "context-menu": "ContextMenu.vue",
  "info-window": "InfoWindow.vue",
};

/** kind → PascalCase 接口名（`bezier-curve` → `BezierCurveEmits`）。 */
function emitsNameOf(kind: string): string {
  const pascal = kind
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}Emits`;
}

function keyOf(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

interface EmitsEntry {
  readonly key: string;
  readonly name: string;
  readonly payload?: string;
  /** 渲染到该键上方的 `/** … *\/` 注释。 */
  readonly note: string;
}

/** 矩阵 + 非 SDK 事件（减去显式排除）→ 该 kind 的完整键集。 */
function entriesOf(kind: string): EmitsEntry[] {
  const matrix = OVERLAY_EVENT_MATRIX[kind];
  if (!matrix) throw new Error(`${kind} 不在 OVERLAY_EVENT_MATRIX 里`);
  const overrides = PAYLOAD_OVERRIDES_BY_KIND[kind] ?? {};
  const excluded = EXCLUDED_EVENTS[kind] ?? {};

  for (const name of Object.keys(excluded)) {
    if (!matrix.events[name]) {
      throw new Error(`EXCLUDED_EVENTS 里的 ${kind}.${name} 不在事件矩阵里（排除一个不存在的键？）`);
    }
  }

  const entries: EmitsEntry[] = Object.values(matrix.events)
    .filter((event) => !Object.hasOwn(excluded, event.vue))
    .map((event) => {
      if (!(event.payload in PAYLOAD_TYPE_BY_KIND)) {
        throw new Error(`${kind}.${event.vue} 的载荷档 ${event.payload} 不在 PAYLOAD_TYPE_BY_KIND 里`);
      }
      const overridden = Object.hasOwn(overrides, event.vue);
      return {
        key: keyOf(event.vue),
        name: event.vue,
        payload: overridden ? overrides[event.vue] : PAYLOAD_TYPE_BY_KIND[event.payload],
        note: commentFor(kind, event.vue, "matrix") + (overridden ? FORWARDED_HINT : ""),
      };
    });

  for (const [name, entry] of Object.entries(NON_SDK_EVENTS[kind] ?? {})) {
    entries.push({
      key: keyOf(name),
      name,
      payload: entry.payload,
      note: `本库事件（不是 SDK 事件）：${entry.origin} 派发。`,
    });
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) throw new Error(`${kind} 的 emits 键 ${entry.key} 重复`);
    seen.add(entry.key);
  }
  return entries;
}

/**
 * 核对 `NON_SDK_EVENTS` 里的每个名字真的有人在派发，且派发**带上了声明的载荷**。
 *
 * 这是必须补的一道：`defineEmits` 里声明一个永不触发的事件，Vue / vue-tsc 都不报错，
 * 模板里的 `@foo` 只是一个永远不会被调用的 handler——比缺声明更难发现。
 */
function assertNonSdkDispatched(kind: string): void {
  for (const [name, entry] of Object.entries(NON_SDK_EVENTS[kind] ?? {})) {
    const file = resolve(root, "packages/bmap-vue/src", entry.origin);
    if (!existsSync(file)) throw new Error(`派发点不存在：${relative(root, file)}`);
    const source = readFileSync(file, "utf8");
    const bare = `emit("${name}"`;
    const bareSingle = `emit('${name}'`;
    if (!source.includes(bare) && !source.includes(bareSingle)) {
      throw new Error(
        `${kind} 的 ${name} 登记在 NON_SDK_EVENTS，但 ${entry.origin} 里没有 emit("${name}", …) 调用`,
      );
    }
    if (entry.payload && !source.includes(`${bare},`) && !source.includes(`${bareSingle},`)) {
      throw new Error(
        `${kind} 的 ${name} 声明了载荷 ${entry.payload}，但 ${entry.origin} 里的 emit 没有带载荷实参`,
      );
    }
  }
}

/** SFC 必须 `import` 本产物的 interface 并把它用作 `defineEmits` 的泛型实参。 */
function assertSfcUsesGenerated(sfc: string, emitsName: string): void {
  const path = resolve(root, "packages/bmap-vue/src/components/overlays", sfc);
  const source = readFileSync(path, "utf8");
  if (!source.includes(emitsName)) {
    throw new Error(`${sfc} 没有引用 ${emitsName}（应 import 后 defineEmits<${emitsName}>）`);
  }
  if (!new RegExp(`defineEmits<\\s*${emitsName}\\s*>`).test(source)) {
    throw new Error(`${sfc} 的 defineEmits 泛型实参不是 ${emitsName}`);
  }
}

/**
 * 把 `name`（带引号的键，如 `"update:open"`）拆回裸事件名。
 */
function bareNameOf(key: string): string {
  return key.replace(/^"|"$/g, "");
}

/** 从产物文本里解析出每个 interface 的 `{ 键: 载荷 }`，供 `--forbid` 自查与测试复用。 */
export function parseEmitsModule(source: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  const blocks = source.matchAll(/export interface (\w+Emits) \{([\s\S]*?)\n\}/g);
  for (const [, name, body] of blocks) {
    const entries: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const match = /^\s{2}("?[\w:$?-]+"?): \[(?:event: (.+))?\];$/.exec(line);
      if (match) entries[match[1]!.replace(/^"|"$/g, "")] = match[2] ?? "";
    }
    result[name!] = entries;
  }
  return result;
}

function render(): string {
  const kinds = Object.keys(OVERLAY_EVENT_MATRIX);
  const lines: string[] = [];
  lines.push("// Generated file. Do not edit directly.");
  lines.push("//");
  lines.push("// 由 scripts/generate-overlay-emits.mts 生成，事实源三处：");
  lines.push("//   1. core/overlays/overlayEventCatalog.ts 的 OVERLAY_EVENT_MATRIX（SDK 事件 + 载荷档）");
  lines.push("//   2. scripts/generate-overlay-emits.mts 的 NON_SDK_EVENTS（本库事件 + 派发点）");
  lines.push("//   3. scripts/generate-overlay-emits.mts 的 EXCLUDED_EVENTS（矩阵有、但本库无派发点的键）");
  lines.push("//");
  lines.push("// 改事实源后跑 `pnpm generate:overlay-emits`；CI 用 `--check` 校验无漂移。");
  lines.push("//");
  lines.push("// 为什么是**显式键 interface** 而不是 mapped type：`@vue/compiler-sfc` 必须把");
  lines.push("// `defineEmits` 的类型实参解析成有限个键，`{ [K in keyof typeof MATRIX]: … }` 与含条件");
  lines.push("// 类型的值都会报 `Failed to resolve index type into finite keys`（完整实测表见");
  lines.push("// core/events/eventCatalog.ts 的 `MapEventEmits`）。名字只在这里写死一次，");
  lines.push("// 运行时仍由内核按矩阵绑定——两边由生成器 join，不是各写一遍。");
  lines.push('import type {');
  lines.push("  OverlayEventPayload,");
  lines.push("  OverlayPartialPointerEvent,");
  lines.push("  OverlayPointerEvent,");
  lines.push('} from "../../driver/types/events";');
  lines.push('import type { Point } from "../../driver/types/geometry";');
  lines.push('import type { ContextMenuSelectPayload } from "../../types/components";');
  lines.push("");

  for (const kind of kinds) {
    assertNonSdkDispatched(kind);
    const sfc = SFC_BY_KIND[kind];
    if (!sfc) throw new Error(`${kind} 没有登记 SFC 文件名`);
    const emitsName = emitsNameOf(kind);
    assertSfcUsesGenerated(sfc, emitsName);

    const entries = entriesOf(kind);
    const matrixNames = Object.keys(OVERLAY_EVENT_MATRIX[kind]!.events);
    const excludedNames = Object.keys(EXCLUDED_EVENTS[kind] ?? {});
    const sdkCount = matrixNames.length - excludedNames.length;
    const localCount = entries.length - sdkCount;
    const parts = [`${sdkCount} 个 SDK 事件`];
    if (excludedNames.length > 0) parts.push(`（另排除 ${excludedNames.length} 个无派发点：${excludedNames.join("、")}）`);
    if (localCount > 0) parts.push(`+ ${localCount} 个本库事件`);
    lines.push(
      `/** \`${kind}\` 覆盖物的事件面：${parts.join(" ")}（共 ${entries.length} 个），` +
        `供 \`${sfc}\` 的 \`defineEmits\` 使用。 */`,
    );
    lines.push(`export interface ${emitsName} {`);
    for (const entry of entries) {
      lines.push(`  /** ${entry.note} */`);
      lines.push(entry.payload ? `  ${entry.key}: [event: ${entry.payload}];` : `  ${entry.key}: [];`);
    }
    lines.push("}");
    lines.push("");
  }

  // 两张偏离表在产物里留痕：读者在 IDE 里看到 `open: []` 或「`resize` 不在接口里」时，
  // 抬头就能查到为什么（否则只会以为是生成器漏了）。
  const deviations: string[] = [];
  for (const [kind, map] of Object.entries(EXCLUDED_EVENTS)) {
    for (const [name, reason] of Object.entries(map)) {
      deviations.push(` * - \`${kind}.${name}\` **不在**本接口里：${reason}`);
    }
  }
  for (const [kind, map] of Object.entries(PAYLOAD_OVERRIDES_BY_KIND)) {
    for (const [name] of Object.entries(map)) {
      deviations.push(
        ` * - \`${kind}.${name}\` 的载荷**不按矩阵的 \`payload\` 档**：本组件不走 ` +
          "`useOverlaySpec`，事件由 `useInfoWindow` 原样转发上游回调参数（不经过归一化）。",
      );
    }
  }
  if (deviations.length > 0) {
    lines.push("/**");
    lines.push(" * 事件矩阵与本文件声明之间的**全部**已知偏离，逐条给出理由。");
    lines.push(" * 除此之外没有任何偏离：矩阵有的键都在这里，载荷也都等于矩阵的档。");
    lines.push(" *");
    lines.push(...deviations);
    lines.push(" */");
    lines.push("");
  }

  return lines.join("\n");
}

const expected = render();
const check = process.argv.includes("--check");
const forbid = process.argv.find((arg) => arg.startsWith("--forbid="))?.slice("--forbid=".length);

/**
 * `--forbid=<事件名>`：核实该名字**不在**任何生成 interface 里。
 *
 * 用途是把「某事件不暴露」这条决定变成会红的一条，而不是注释里的一句话——例如
 * `resize`：它在上游事件表里存在，但本库没有派发点，声明它只会让人绑上一个永不触发的
 * handler。跑法：`node --experimental-strip-types scripts/generate-overlay-emits.mts --forbid=resize`。
 */
if (forbid !== undefined) {
  const parsed = parseEmitsModule(expected);
  const hits = Object.entries(parsed).filter(([, entries]) => forbid in entries);
  if (hits.length > 0) {
    console.error(
      `[overlay-emits] --forbid=${forbid} 失败：${hits.map(([name]) => name).join(", ")} 声明了它`,
    );
    process.exitCode = 1;
  } else {
    console.log(`[overlay-emits] OK, ${forbid} is not declared in any generated emits interface.`);
  }
} else if (!check) {
  writeFileSync(outputPath, expected);
  console.log(
    `[overlay-emits] wrote ${relative(root, outputPath)} (${Object.keys(OVERLAY_EVENT_MATRIX).length} kinds)`,
  );
} else {
  const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (current !== expected) {
    console.error(`[overlay-emits] DRIFT detected: ${relative(root, outputPath)}`);
    console.error("  run: pnpm generate:overlay-emits");
    process.exitCode = 1;
  } else {
    console.log(`[overlay-emits] OK, no drift (${Object.keys(OVERLAY_EVENT_MATRIX).length} kinds).`);
  }
}
