/**
 * #138：覆盖物 `defineEmits` 静态契约是**生成物**，本文件把生成关系钉成可执行断言
 *
 * 迁移到 `OverlaySpec` 之后，运行时事件面（`core/overlays/overlayEventCatalog.ts` 的矩阵）已经是
 * 单一事实源，但 SFC 的 `defineEmits` 曾长期是「矩阵一份 + 手抄一份」：矩阵加一个事件，12 个组件
 * 里谁忘了改，只能靠一条事后刮源码的测试兜底。#138 把这一半也交给生成器
 * （`scripts/generate-overlay-emits.mts`），本文件守的是「生成关系」本身：
 *
 * 1. **产物 == 三处事实源的 join**：`pnpm generate:overlay-emits:check` 的语义等价断言
 *    （重新生成的内容 == 磁盘内容；**读盘比对，不写盘**）；
 * 2. **逐键来源可追**：每个生成键要么来自矩阵、要么来自弃用别名表、要么来自非 SDK 事件表，
 *    且别名与本库事件的载荷与来源一致（生成器内的 join 逻辑在这里被独立复算一次）；
 * 3. **SFC 真的消费了生成类型**：类型层看不到 SFC 的泛型实参，只能查文本——如实说明见
 *    ADR #138 决策 ⑥；
 * 4. **`resize` 不进声明**：官方 `InfoWindowEventMap` 有它、本库没有派发点。这是一条**会红**的
 *    决定，不是注释里的一句话（见生成脚本的 `--forbid` 模式）。
 *
 * 与 `v3-overlay-suite.test.ts` 里那段门禁的分工：那里查「每个组件的声明面是什么」，
 * 这里查「声明面**怎么来的**、以及生成器自己有没有说谎」。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OVERLAY_EVENT_MATRIX,
  overlayEventsOf,
} from "../../packages/bmap-vue/src/core/overlays/overlayEventCatalog";
import { OVERLAY_EVENT_ALIASES } from "../../packages/bmap-vue/src/core/deprecations";
import type { OverlayKind } from "../../packages/bmap-vue/src/driver/types/overlays";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const GENERATOR = resolve(REPO_ROOT, "scripts/generate-overlay-emits.mts");
const GENERATED_FILE = resolve(
  REPO_ROOT,
  "packages/bmap-vue/src/core/overlays/overlayEventEmits.generated.ts",
);

type PayloadKind = "pointer" | "partial-pointer" | "base";

const PAYLOAD_TYPE_BY_KIND: Record<PayloadKind, string> = {
  pointer: "OverlayPointerEvent",
  "partial-pointer": "OverlayPartialPointerEvent",
  base: "OverlayEventPayload",
};

/** `<InfoWindow>` 原样转发的那 5 个事件：载荷不按矩阵档声明（理由见生成脚本的覆写表）。 */
const FORWARDED_OVERRIDES: Record<string, string | undefined> = {
  open: undefined,
  close: undefined,
  clickclose: "unknown",
  maximize: "unknown",
  restore: "unknown",
};

/** 矩阵里有、但本库没有派发点（因此不进声明）的键。 */
const EXCLUDED: Record<string, readonly string[]> = {
  "info-window": ["resize"],
};

interface EmitsDeclaration {
  /** interface 名（`MarkerEmits` …）。 */
  readonly name: string;
  /** 事件名 → 载荷类型名（无载荷 = `""`）。 */
  readonly entries: Record<string, string>;
}

function kindToInterfaceName(kind: string): string {
  const pascal = kind
    .split("-")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}Emits`;
}

/** 解析生成物：返回全部 `<Kind>Emits` 声明。 */
function readGenerated(): EmitsDeclaration[] {
  const source = readFileSync(GENERATED_FILE, "utf8");
  const declarations: EmitsDeclaration[] = [];
  for (const block of source.matchAll(/export interface (\w+Emits) \{([\s\S]*?)\n\}/g)) {
    const entries: Record<string, string> = {};
    for (const line of block[2]!.split("\n")) {
      const match = /^ {2}("?[\w:$?-]+"?): \[(?:event: (.+))?\];$/.exec(line);
      if (match) entries[match[1]!.replace(/^"|"$/g, "")] = match[2] ?? "";
    }
    expect(
      Object.keys(entries).length,
      `${block[1]} 解析到 0 个条目（生成物格式变了？）`,
    ).toBeGreaterThan(0);
    declarations.push({ name: block[1]!, entries });
  }
  return declarations;
}

function runGenerator(...args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ["--experimental-strip-types", GENERATOR, ...args],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("#138 生成的覆盖物 emits 静态契约", () => {
  it("--check 无漂移（重新渲染 == 磁盘内容；只读盘比对，不写盘）", () => {
    const before = readFileSync(GENERATED_FILE, "utf8");
    const result = runGenerator("--check");
    expect(result.stderr + result.stdout, result.stderr).toContain("no drift");
    // 关键性质：--check 不写盘（跑完内容逐字节不变）
    expect(readFileSync(GENERATED_FILE, "utf8")).toBe(before);
  });

  it("每个矩阵 kind 都有且只有一个生成的 interface（SFC 按它取名，不靠人记）", () => {
    const names = readGenerated().map((declaration) => declaration.name).sort();
    expect(names).toEqual(Object.keys(OVERLAY_EVENT_MATRIX).map(kindToInterfaceName).sort());
  });

  it("矩阵的每个键都在（排除项除外）且载荷等于该键的档", () => {
    const byInterface = new Map(readGenerated().map((d) => [d.name, d.entries]));
    for (const kind of Object.keys(OVERLAY_EVENT_MATRIX) as OverlayKind[]) {
      const declared = byInterface.get(kindToInterfaceName(kind))!;
      const excluded = new Set(EXCLUDED[kind] ?? []);
      for (const event of overlayEventsOf(kind)) {
        if (excluded.has(event.vue)) {
          expect(declared, `${kind}.${event.vue} 是排除项，不该出现在声明里`).not.toHaveProperty(event.vue);
          continue;
        }
        const overridden =
          kind === "info-window" && Object.hasOwn(FORWARDED_OVERRIDES, event.vue);
        const expected = overridden
          ? FORWARDED_OVERRIDES[event.vue]
          : PAYLOAD_TYPE_BY_KIND[event.payload];
        expect(declared[event.vue], `${kind}.${event.vue} 的载荷`).toBe(expected ?? "");
      }
    }
  });

  it("历史别名与正典名同载荷，并带 @deprecated 注释（不静默兼容）", () => {
    const source = readFileSync(GENERATED_FILE, "utf8");
    const byInterface = new Map(readGenerated().map((d) => [d.name, d.entries]));
    for (const alias of OVERLAY_EVENT_ALIASES) {
      const declared = byInterface.get(kindToInterfaceName(alias.kind))!;
      const canonical = overlayEventsOf(alias.kind).find((e) => e.vue === alias.canonical)!;
      expect(declared[alias.alias], `${alias.alias} 没有被声明`).toBe(
        declared[alias.canonical],
      );
      expect(declared[alias.alias], `${alias.alias} 的载荷应与正典名一致`).toBe(
        PAYLOAD_TYPE_BY_KIND[canonical.payload],
      );
      // 注释在生成物里：读者在 IDE 悬停时能看到这是弃用名
      expect(source).toContain(`/** @deprecated 历史别名；规范名是 \`${alias.canonical}\``);
    }
  });

  it("非 SDK 事件（本库 v-model 回写 / 生命周期 / 菜单选中）都在，且逐个指向派发点", () => {
    const byInterface = new Map(readGenerated().map((d) => [d.name, d.entries]));
    // 这三条与生成脚本 NON_SDK_EVENTS 对齐
    expect(byInterface.get("MarkerEmits")!["update:position"]).toBe("Point");
    expect(byInterface.get("InfoWindowEmits")!["update:open"]).toBe("boolean");
    expect(byInterface.get("InfoWindowEmits")!["update:show"]).toBe("boolean");
    expect(byInterface.get("InfoWindowEmits")!["rebuild"]).toBe("number");
    expect(byInterface.get("InfoWindowEmits")!["destroy"]).toBe("number");
    expect(byInterface.get("ContextMenuEmits")!["select"]).toBe("ContextMenuSelectPayload");
  });

  it("排除项与载荷覆写在生成物里逐条留痕（偏离不是静默的）", () => {
    const source = readFileSync(GENERATED_FILE, "utf8");
    expect(source).toContain("`info-window.resize` **不在**本接口里");
    for (const name of Object.keys(FORWARDED_OVERRIDES)) {
      expect(source).toContain(`\`info-window.${name}\` 的载荷**不按矩阵的 \`payload\` 档**`);
    }
  });

  it("resize 不在任何生成的 interface 里（--forbid 会红；声明它只会得到永不触发的 handler）", () => {
    // 官方 InfoWindowEventMap 确实声明了 resize——排除是显式决定
    expect(overlayEventsOf("info-window").map((e) => e.vue)).toContain("resize");
    // `--forbid` 模式把这个决定变成可执行断言
    const ok = runGenerator("--forbid=resize");
    expect(ok.stdout + ok.stderr).toContain("resize is not declared");
    // 反向：一个**确实**声明了的名字必须让 --forbid 失败（否则这条门禁是空转）
    const bad = runGenerator("--forbid=dragend");
    expect(bad.status, "拖拽事件确实被声明，--forbid=dragend 必须失败").not.toBe(0);
  });

  it("SFC 消费生成的 interface（defineEmits 泛型实参；类型层看不到，只能查文本）", () => {
    const files: Record<string, string> = {
      MarkerEmits: "Marker.vue",
      LabelEmits: "Label.vue",
      PolylineEmits: "Polyline.vue",
      PolygonEmits: "Polygon.vue",
      RectangleEmits: "Rectangle.vue",
      CircleEmits: "Circle.vue",
      PrismEmits: "Prism.vue",
      BezierCurveEmits: "BezierCurve.vue",
      GroundOverlayEmits: "GroundOverlay.vue",
      CustomOverlayEmits: "CustomOverlay.vue",
      ContextMenuEmits: "ContextMenu.vue",
      InfoWindowEmits: "InfoWindow.vue",
    };
    for (const [name, file] of Object.entries(files)) {
      const source = readFileSync(
        resolve(REPO_ROOT, "packages/bmap-vue/src/components/overlays", file),
        "utf8",
      );
      expect(source, `${file} 没有 import ${name}`).toContain(name);
      expect(source, `${file} 的 defineEmits 实参不是 ${name}`).toMatch(
        new RegExp(`defineEmits<\\s*${name}\\s*>`),
      );
    }
  });
});
