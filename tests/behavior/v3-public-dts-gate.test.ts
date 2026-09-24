/**
 * 公共声明门禁自测（M3A0-04 / issue #15）
 *
 * - 正向：声明产物中出现 `namespace BMap` / `declare global` / `BMap.*` /
 *   官方类型包引用 / 类型边界文件时门禁必须失败；
 * - 负向：组件同名导出 `BMap` 与纯业务类型不得误报；
 * - 构建产物缺失时明确报错，不静默放行。
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/check-public-dts.mts");
const REAL_DIST = resolve(import.meta.dirname, "../../packages/bmap-vue/dist");

interface GateResult {
  code: number;
  output: string;
}

function runGate(distDir: string): GateResult {
  try {
    const output = execFileSync(
      process.execPath,
      ["--experimental-strip-types", SCRIPT, "--dir", distDir],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "public-dts-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const CLEAN_DTS = [
  'declare const BMap: import("vue").DefineComponent<{ zoom?: number }>;',
  "export { BMap };",
  "export declare type BMapProps = { zoom?: number };",
  "export declare const version: string;",
  "",
].join("\n");

describe("public d.ts gate", () => {
  it("放行组件同名导出 BMap 与纯业务类型", () => {
    const dir = makeDist({ "index.d.ts": CLEAN_DTS, "components.d.ts": CLEAN_DTS });
    const r = runGate(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("public d.ts gate OK");
    rmSync(dir, { recursive: true, force: true });
  });

  it("拦截 declare global / namespace BMap 泄漏", () => {
    const dir = makeDist({
      "index.d.ts": "declare global { namespace BMap { interface X {} } }\nexport {};\n",
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("[namespace-declaration]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("拦截 BMap.* 类型引用与 official types 三斜线引用", () => {
    const dir = makeDist({
      "index.d.ts": [
        '/// <reference types="@baidumap/jsapi-v4-types" />',
        'export declare const create: () => new BMap.Map("c");',
        "export declare const point: BMap.Point;",
        "",
      ].join("\n"),
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("[official-types-reference]");
    expect(r.output).toMatch(/\[(namespace-root|type-position)\]/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("拦截类型边界文件进入发布产物", () => {
    const dir = makeDist({
      "index.d.ts": CLEAN_DTS,
      "driver/jsapi-v4/types-reference.d.ts": "export {};\n",
    });
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("[boundary-file-published]");
    rmSync(dir, { recursive: true, force: true });
  });

  it("声明产物缺失时明确失败", () => {
    const dir = join(tmpdir(), `public-dts-missing-${Date.now()}`);
    const r = runGate(dir);
    expect(r.code).toBe(1);
    expect(r.output).toContain("pnpm build:package");
  });

  it.runIf(existsSync(REAL_DIST))("真实构建产物无 BMap 泄漏", () => {
    const r = runGate(REAL_DIST);
    expect(r.output).toBeDefined();
    expect(r.code).toBe(0);
  });
});

/**
 * 评审 F2 回归：三斜线 `types` 引用必须按**包名**判定。
 *
 * 每个 fixture 只放引用指令本身，不放 `BMap.Point` 之类的其它违规，
 * 否则其它规则会先命中、掩盖这里的漏报。
 */
describe("public d.ts gate: 三斜线 types 引用的排版无关性（评审 F2）", () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ["紧凑写法", '/// <reference types="@baidumap/jsapi-v4-types" />'],
    ["单引号", "/// <reference types='@baidumap/jsapi-v4-types' />"],
    ["等号带空格", '/// <reference types = "@baidumap/jsapi-v4-types" />'],
    ["types 非首个属性", '/// <reference preserve="true" types="@baidumap/jsapi-v4-types" />'],
    ["多属性 + 空格混排", "/// <reference preserve='true' types = '@baidumap/jsapi-v4-types' />"],
  ];

  for (const [label, directive] of CASES) {
    it(`拦截「${label}」的官方类型包引用指令`, () => {
      const dir = makeDist({ "index.d.ts": `${directive}\nexport {};\n` });
      const r = runGate(dir);
      expect(r.code, `应失败: ${directive}`).toBe(1);
      expect(r.output).toContain("[official-types-reference]");
      expect(r.output).toContain("index.d.ts:1");
      rmSync(dir, { recursive: true, force: true });
    });
  }

  it("放行非官方类型包的三斜线引用", () => {
    const dir = makeDist({
      "index.d.ts": [
        '/// <reference types="vite/client" />',
        '/// <reference path="./something.d.ts" />',
        "export {};",
        "",
      ].join("\n"),
    });
    const r = runGate(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("public d.ts gate OK");
    rmSync(dir, { recursive: true, force: true });
  });
});
