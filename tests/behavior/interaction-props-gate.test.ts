/**
 * 交互开关 prop「未传可达性」门禁自测（issue #179）
 *
 * ## 这道门禁在防什么
 *
 * `<Map>` 的 `syncEnableProps` 靠 `value === undefined` 表达「不表态，交给 SDK 用它自己声明的
 * 默认值」。但 Vue 把**缺省 `Boolean` prop** 的「没传」强转成 `false`，所以一个交互 prop 只要
 * 没在 `withDefaults` 里显式出现，这个守卫对它就**永不命中**，每次建图都被逐个 `disable*()`。
 * 官方 `core/MapOptions.d.ts` 声明 `@default true` 的 `enableDblclickZoom` / `enablePinchZoom`
 * 因此被静默关掉——用户什么都不写，双指缩放与双击缩放就没了。
 *
 * ## 失效方式
 *
 * 和 `check-doc-props` 同一条理由：抽取器写错会让门禁**恒绿**（扫不到东西）或**恒红**
 * （把全部 prop 判成不符），两种失效在日志上都跟「真的干净」长得一样。所以每条规则都配正反例，
 * 并断言**真实扫描面确实扫到了东西**。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-interaction-props.mts");
const MAP_VUE = join(ROOT, "packages/bmap-vue/src/components/map/Map.vue");

interface GateResult {
  code: number;
  output: string;
}

function runGate(args: string[] = []): GateResult {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const fixtureDirs: string[] = [];

/** 拿真实 `Map.vue` 改几行后落成临时文件——正例与真实面同源，避免「造了个不像的假 SFC」。 */
function makeMapFixture(mutate: (text: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), "interaction-props-"));
  const file = join(dir, "Map.vue");
  writeFileSync(file, mutate(readFileSync(MAP_VUE, "utf8")));
  fixtureDirs.push(dir);
  return file;
}

afterEach(() => {
  while (fixtureDirs.length > 0) rmSync(fixtureDirs.pop()!, { recursive: true, force: true });
});

describe("check-interaction-props · 判据有区分力", () => {
  it("真实的 Map.vue 通过，并且**确实扫到了东西**", () => {
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    // 关键：不能是「扫到 0 个所以通过」。这是本用例最重要的一条。
    const match = /INTERACTION_PROPS 的 (\d+) 个 prop/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    // 12 项 = INTERACTION_PROPS 当前的完整名单（dragging / wheel / inertial / pinch /
    // keyboard / dblclick / continuous / fixCenter / rotate / rotate-gestures / tilt /
    // tilt-gestures —— 后四项由 #167 第一批补上）。
    expect(Number(match![1]), r.output).toBe(12);
  });

  it("少一个 prop 就红，并点名是哪一个", () => {
    // 反例：把 enablePinchZoom 从 withDefaults 里删掉（即 #179 修复前的状态）。
    const r = runGate(["--file", makeMapFixture((t) => t.replace(/\n\s*enablePinchZoom: undefined,/, ""))]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("enablePinchZoom");
    expect(r.output).toContain("没有出现在 withDefaults 里");
    // 其余十一项不该被牵连——门禁只报真正缺的那几个。
    expect(r.output).toContain("1/12");
  });

  it("值写成 true / false 同样算通过（判据是**存在性**，不是值等于 undefined）", () => {
    // enableDragging: true 与 enableWheelZoom: false 是**有意**偏离官方的决策，
    // 门禁若要求「必须等于 undefined」就会把它们顶红 —— 那才叫判据退化成常量。
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("enableDragging");
    expect(r.output).toContain("enableWheelZoom");
  });

  it("表格改名后判据空转 ⇒ **判失败**（fail-closed，不静默放行）", () => {
    const r = runGate(["--file", makeMapFixture((t) => t.replaceAll("INTERACTION_PROPS", "RENAMED_TABLE"))]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("门禁就空转了");
  });

  it("withDefaults 被整个去掉时判失败，而不是当成一张空表", () => {
    const r = runGate([
      "--file",
      makeMapFixture((t) => t.replace(/const props = withDefaults\([\s\S]*?\n\}\);/, "const props = {};")),
    ]);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("withDefaults");
  });
});

describe("check-interaction-props · CI 接线", () => {
  it("门禁真的在 quality job 里跑，且没被架空", () => {
    const block = stepBlockContaining(
      readWorkflow("quality.yml"),
      "scripts/check-interaction-props.mts",
    );
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    const text = block.join("\n");
    expect(text).toContain("run: node --experimental-strip-types scripts/check-interaction-props.mts");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:interaction-props"]).toContain("scripts/check-interaction-props.mts");
  });
});
