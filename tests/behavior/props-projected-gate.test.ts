/**
 * 「声明了却没有读者」反向门禁的自测（issue #177）
 *
 * ## 这道门禁在防什么
 *
 * `onLocationStart` 在 `LocationControlProps` 里声明了、`ControlSpec.options()` 没带它，
 * 于是它**类型检查通过、Vue 正常接收、然后被静默丢弃**。已有的声明面门禁全都看不见这一侧：
 * `overlay-suite.test.ts` 比对的是「声明的键都有落地方式」，`check-doc-props.mts` 扫的是
 * **文档**与声明面，`OverlayFieldMap` 只覆盖走 `useOverlaySpec` 的那一档。
 *
 * ## 失效方式
 *
 * 抽取器写错会让门禁**恒绿**（扫不到东西）或**恒红**（把所有 prop 判成没读者）。
 * 因此这里每条规则都配**反证**：真实扫描面必须通过，而人为制造的一处「声明了没人读」
 * 必须被抓出来——两者一起断言，才排除了「扫到 0 个所以通过」。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auditSources } from "../../scripts/check-props-projected.mts";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-props-projected.mts");

/** 把一段 `<script setup>` 文本包成 SFC（判据吃的是完整 SFC 文本）。 */
const SFC = (scriptSetup: string): string =>
  `<template><slot /></template>\n<script setup lang="ts">\n${scriptSetup}\n</script>\n`;

interface ScanResult {
  code: number;
  output: string;
}

function runGate(): ScanResult {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("check-props-projected · 判据有区分力", () => {
  it("真实扫描面通过，并且**确实扫到了东西**", () => {
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    // 关键：不能是「扫到 0 个所以通过」。当前扫描面是 11 个控件 + 16 个覆盖物。
    const match = /已扫 (\d+) 个组件/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(27);
  });

  /**
   * 反证：合成一个「声明了 `mapTypes` 但 `options()` 没投影它」的控件，判据必须点名它。
   *
   * 只跑真实扫描面不足以证明判据有区分力——一个「恒返回通过」的抽取器同样能让上一条绿。
   * 这一点与 `check-doc-props` 的自测同款（正例 + 反例一起断言）。
   *
   * ⚠️ 这里用**合成源码**驱动 `auditSources`，刻意**不去改磁盘上的真组件**：
   * 改真文件会让并行的其它测试文件读到半个组件。实测踩过——本用例一度把
   * `controls.test.ts` 里一条数 Fake 控件总数的断言带崩（那个计数是模块级的）。
   *
   * 也刻意不拿 `anchor` / `offset` / `visible` 当反证：那三个是 `ControlBaseProps`
   * 的成员，**按设计**走各自的通道（`visible` → `applyVisible`），门禁有意不管它们。
   * 拿豁免项当反证测到的是「豁免逻辑」，不是本条判据。
   */
  it("反证：合成一个没投影的 prop ⇒ 判据点名它（证明它不是恒绿）", () => {
    const baseProps = new Set(["anchor", "offset", "visible"]);
    const declared = auditSources(
      [
        {
          rel: "components/controls/MapTypeControl.vue",
          text: SFC(`
export interface MapTypeControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  mapTypes?: readonly number[];
  showStreetLayer?: boolean;
  visible?: boolean;
}
const props = defineProps<MapTypeControlProps>();
const spec = {
  kind: "map-type",
  options: (p) => ({ anchor: p.anchor, offset: p.offset, showStreetLayer: p.showStreetLayer }),
};
useControlResource(props, spec);
defineOptions({ name: "MapTypeControl" });
`),
        },
      ],
      baseProps,
    );
    expect(declared.problems).toEqual([]);
    expect(declared.unread).toEqual([
      {
        file: "components/controls/MapTypeControl.vue",
        component: "MapTypeControl",
        prop: "mapTypes",
      },
    ]);
  });

  it("同一个合成控件把 mapTypes 补回 options() ⇒ 判据不再报它", () => {
    const baseProps = new Set(["anchor", "offset", "visible"]);
    const declared = auditSources(
      [
        {
          rel: "components/controls/MapTypeControl.vue",
          text: SFC(`
export interface MapTypeControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  mapTypes?: readonly number[];
  showStreetLayer?: boolean;
  visible?: boolean;
}
const props = defineProps<MapTypeControlProps>();
const spec = {
  kind: "map-type",
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    mapTypes: p.mapTypes,
    showStreetLayer: p.showStreetLayer,
  }),
};
useControlResource(props, spec);
defineOptions({ name: "MapTypeControl" });
`),
        },
      ],
      baseProps,
    );
    expect(declared.problems).toEqual([]);
    expect(declared.unread).toEqual([]);
  });
});

describe("check-props-projected · CI 接线", () => {
  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:props-projected"]).toContain("scripts/check-props-projected.mts");
  });

  it("quality job 真的在跑它，且没被架空", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/quality.yml"), "utf8");
    const index = workflow.indexOf("scripts/check-props-projected.mts");
    expect(index, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(-1);
    const step = workflow.slice(index, workflow.indexOf("\n", index) + 400);
    expect(step).not.toContain("continue-on-error");
    expect(step).not.toMatch(/^\s*if:/m);
  });
});
