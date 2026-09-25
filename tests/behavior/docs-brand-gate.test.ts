/**
 * 文档面品牌门禁自测（issue #141）
 *
 * 这道门禁的失效方式有四种，**每种都会静默放行**，因此每种各配正反例：
 *
 * 1. **判据写歪 / 扫错对象** → 违规串不红。喂「历史上真在发布面出现过」的形状
 *    （旧包名、旧产品名、`BPointShapeLayer`、裸 `3.0`、迁移导航词），要求逐条命中。
 *    其中 `BPointShapeLayer` 与裸 `3.0` 是**当前树上真实存在的**漂移
 *    （`components/data.md` 讲的是未发布的历史命名，`guide/config.md` 用 3.0 描述本库），
 *    它们曾经让这道门禁的第一版「看起来没有用」。
 * 2. **判据过宽（误伤）** → 把**当前**的发布面判成违规。这比漏报更危险：它逼出
 *    「为了过门禁而改注释」的本末倒置。所以每一节都配一个**近似但合规**的输入要求放行。
 *    本文件里最容易误伤的三类，逐条钉住：
 *      - `yue1123/vue3-baidu-map-gl` —— MIT 归属义务，必须在 README / NOTICE / LICENSE 里。
 *      - `BMap.*` / `BMapProvider` / `BMapClient` / `BMapError` —— 36 处当前公开类型 + SDK 命名空间。
 *      - 官方 loader 的 `version: '3.0'` —— 上游选项值，不是本库的库版本。
 * 3. **豁免机制被当成后门** → 逐行豁免如果「不写理由也生效」或「一豁免一整段」，
 *    它就是一个注释掉的门禁。三条约束各有正反例。
 * 4. **扫描范围空转** → 一个文件都没扫到时也会「通过」。脚本自身对每个相位 fail-closed，
 *    用例侧再断言该相位**真的扫到了文件**（后者保证「这条用例测的相位确实被测到了」）。
 *
 * 最后一节把门禁接回仓库：真实树的不变量、豁免预算、以及 CI 接线本身的正证
 * （step 存在、没被 `continue-on-error` 架空、落在正确的 job 里）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DOCS_BRAND_RULES,
  MAX_ESCAPES,
  RETIRED_COMPONENT_NAMES,
  docsBrandSummary,
} from "../../scripts/docs-brand-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-docs-brand.mts");

interface ScanResult {
  code: number;
  output: string;
}

function runGate(args: string[]): ScanResult {
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

const scanDir = (dir: string): ScanResult => runGate(["--dir", dir]);

const fixtureDirs: string[] = [];

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "docs-brand-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  fixtureDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (fixtureDirs.length > 0) rmSync(fixtureDirs.pop()!, { recursive: true, force: true });
});

/** 解析输出里的逐相位扫描数（`<label>=<dir>:<N> 个文件`）。 */
function phaseScans(output: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const match of output.matchAll(/([^\s,，()（）=]+)=[^\s,，()（）]*?:(\d+) 个文件/g)) {
    found[match[1]!] = Number(match[2]!);
  }
  return found;
}

describe("check-docs-brand · 正例（判据有区分力的证据）", () => {
  it("旧包名被拦截", () => {
    const r = scanDir(makeFixture({ "install.md": "npm install baidu-map-gl-vue\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("baidu-map-gl-vue");
    expect(r.output).toContain("retired-package");
  });

  it("旧产品名与站点文案被拦截", () => {
    const r = scanDir(
      makeFixture({
        "a.md": "# Vue3 BaiduMap GL\n",
        "b.ts": 'name: "Vue3-BaiduMap-GL",\n',
        "c.ts": "description: 基于百度地图 JavaScript GL 版\n",
        "d.ts": 'keywords: ["vue3-bmap-gl"],\n',
      }),
    );
    expect(r.code).toBe(1);
    // 四种形态都要红：空格 / 连字符 / GL 版 / 短 slug。
    expect(r.output).toContain("Vue3 BaiduMap GL");
    expect(r.output).toContain("Vue3-BaiduMap-GL");
    expect(r.output).toContain("JavaScript GL 版");
    expect(r.output).toContain("vue3-bmap-gl");
  });

  it("旧 resolver 名被拦截", () => {
    const r = scanDir(makeFixture({ "r.ts": "import { Vue3BaiduMapGlResolver } from 'bmap-vue'\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("retired-resolver");
  });

  it("已退役组件名被拦截（逐个名字都要有区分力）", () => {
    // 全部 50 个退役名逐个喂进去：任何一个漏网都会让这条红。
    const body = RETIRED_COMPONENT_NAMES.map((name) => `<${name} />`).join("\n");
    const r = scanDir(makeFixture({ "old.md": body }));
    expect(r.code).toBe(1);
    for (const name of RETIRED_COMPONENT_NAMES) {
      expect(r.output, `${name} 没被拦截`).toContain(`-> ${name} `);
    }
  });

  it("未发布的历史命名 BPointShapeLayer 被拦截（真实漂移：components/data.md 讲的就是它）", () => {
    const r = scanDir(makeFixture({ "d.md": "它曾经叫 `BPointShapeLayer`。\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("BPointShapeLayer");
  });

  it("`BMap` 当 Vue 标签时被拦截", () => {
    const r = scanDir(makeFixture({ "m.md": "<BMap :center=\"c\" />\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("retired-bmap-tag");
  });

  it("已退役 hooks 名被拦截", () => {
    const r = scanDir(makeFixture({ "h.md": "const { x } = useBMapGeocoder()\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("retired-hook");
  });

  it("裸写的 3.0 库版本措辞被拦截（带引号的上游选项值不拦，见下一节）", () => {
    const r = scanDir(makeFixture({ "v.md": "3.0 只有一个引擎。\n" }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("retired-version");
  });

  it("只服务迁移的导航条目被拦截（散文里的同款措辞不拦）", () => {
    const nav = makeFixture({
      "docs/.vitepress/configs/sidebar.config.zh.ts":
        '{ text: "usePoint 地图实例点（v2 已移除，仅留迁移说明）", link: "usePoint" },\n',
    });
    const r = scanDir(nav);
    expect(r.code).toBe(1);
    expect(r.output).toContain("retired-migration-nav");

    // 同样的措辞写进散文是正常的历史说明，必须放行。
    const prose = scanDir(makeFixture({ "note.md": "本库移除了 usePoint（v2 已移除）。直接用 `Point` 类型。\n" }));
    expect(prose.code, prose.output).toBe(0);
  });
});

describe("check-docs-brand · 反例（误伤会让门禁不可用）", () => {
  it("MIT 归属义务放行：原项目名必须能出现在 README / NOTICE / LICENSE", () => {
    const r = scanDir(
      makeFixture({
        "README.md":
          "源自 [yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl)。\n" +
          "见 [NOTICE.md](./NOTICE.md) 与 [LICENSE](./LICENSE)。\n",
        "NOTICE.md": "> Copyright (c) 2021 yue1123\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("当前公开类型与 SDK 命名空间放行（36 处 <BMap… 命中是 B 前缀的**当前**名字）", () => {
    const r = scanDir(
      makeFixture({
        "types.md":
          "`BMapClient` / `BMapError` / `BMapServiceStatus` / `BMapProvider` / `BMapResolver` / `BMapProviderProps`\n" +
          "SDK 侧：`BMap.Map`、`BMap.Icon`、`BMap.InfoWindow`、`BMap.Point`。\n" +
          "<BMapProvider> 是当前组件，<Map> 也是。\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("官方 loader 的 version 取值放行（上游语义，不是本库的库版本）", () => {
    const r = scanDir(
      makeFixture({
        "pkg.md": "| `load(options)` | `version`（`'3.0'｜'gl'｜'4.0'`，默认 `'4.0'`） |\n" + 'const v = "3.0";\n',
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("活着的 CDN 全局名 BMapVue 放行（刻意不收，见 boundary 文件头）", () => {
    const r = scanDir(makeFixture({ "i.md": "然后使用全局变量 `BMapVue`。\n" }));
    expect(r.code, r.output).toBe(0);
  });

  it("含 3.0 的更长数字不误伤", () => {
    const r = scanDir(
      makeFixture({
        "n.md": "4.0.4 / 1.0.0-rc.0 / ^2.3.0 / 2026-09-24 / 1.0.13.0 / v3.0.0-beta\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
  });

  it("当前包名与安装命令放行", () => {
    const r = scanDir(makeFixture({ "n.md": "pnpm add bmap-vue\nnpm install bmap-vue\n" }));
    expect(r.code, r.output).toBe(0);
  });
});

describe("check-docs-brand · 豁免机制不是后门", () => {
  it("带理由的逐行豁免放行", () => {
    const r = scanDir(
      makeFixture({
        "x.md": "官方 React 仍叫 useBMapContext。 <!-- brand-gate:allow 对照表必须引用上游名 -->\n",
      }),
    );
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("1 处放行");
  });

  it("**没有**理由的豁免不生效（否则「注释掉一行」就等于关掉门禁）", () => {
    const r = scanDir(makeFixture({ "x.md": "useBMapContext <!-- brand-gate:allow -->\n" }));
    expect(r.code).toBe(1);
  });

  it("豁免只覆盖它所在的那一行", () => {
    const r = scanDir(
      makeFixture({
        "x.md": "第一行带豁免 <!-- brand-gate:allow 只豁免本行 -->\n第二行同样违规但没有豁免 useBMapContext\n",
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("useBMapContext");
  });
});

describe("check-docs-brand · 空转守卫", () => {
  it("扫描范围为空即判失败（目录配错时放行等于门禁空转）", () => {
    // 目录里有文件，但没有一个落在扫描扩展名里——「什么都没扫到」和「扫了很干净」必须长得不一样。
    const empty = makeFixture({ "notes.txt": "占位，只有不扫的扩展名\n" });
    const r = scanDir(empty);
    expect(r.code).toBe(1);
    expect(r.output).toContain("扫描范围为空");
  });

  it("用例侧独立断言该相位真的扫到了文件（夹具写错路径时立刻红，而不是静默通过）", () => {
    const dir = makeFixture({ "a.md": "# 干净页面\n" });
    const r = scanDir(dir);
    expect(r.code, r.output).toBe(0);
    expect(phaseScans(r.output)["explicit-dir"]).toBeGreaterThanOrEqual(1);
  });
});

describe("check-docs-brand · 真实树不变量", () => {
  const real = runGate([]);

  it("真实发布面无退役品牌串", () => {
    expect(real.code, real.output).toBe(0);
  });

  it("扫描面规模够大（防止有人把扫描根收窄到几乎不扫东西）", () => {
    const scans = phaseScans(real.output);
    const total = Object.values(scans).reduce((a, b) => a + b, 0);
    expect(total, `只扫到 ${total} 个文件，扫描面被收窄了？\n${real.output}`).toBeGreaterThan(150);
  });

  it("四个相位都扫到了文件", () => {
    const scans = phaseScans(real.output);
    for (const phase of docsBrandSummary().phases) {
      expect(scans[phase.label], `${phase.label} 没有扫到文件\n${real.output}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("豁免用量在预算内，且豁免路径不是死代码（用量 > 0）", () => {
    const match = /(\d+) 处放行/.exec(real.output);
    expect(match, real.output).not.toBeNull();
    const used = Number(match![1]);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(MAX_ESCAPES);
  });

  it("docs/adr 确实被排除——排除是受测不变量，不是假设", () => {
    // ADR 里的旧名是**决策史的正文**，如果哪天排除规则被删掉，ADR 就会把门禁顶红。
    const adr = join(ROOT, "docs/adr");
    const drift = readFileSync(join(adr, readdirSync(adr).find((n) => n.endsWith(".md"))!), "utf8");
    expect(drift).toMatch(/baidu-map-gl-vue|Vue3BaiduMapGl|webgl-v1|BMapGL/);
    expect(docsBrandSummary().excludedPathPrefixes).toContain("docs/adr/");
  });

  it("禁词表刻意不含 BMapVue / BMap / BMapGLLib（把「有意不拦」钉成不变量）", () => {
    const sources = DOCS_BRAND_RULES.map((r) => r.pattern.source).join("\n");
    // 名字可以出现在注释里，但不能作为**模式的一部分**去匹配。
    expect(sources).not.toMatch(/BMapVue\\b/);
    expect(sources).not.toMatch(/BMapGLLib/);
  });
});

describe("check-docs-brand · CI 接线", () => {
  const workflow = readWorkflow("quality.yml");
  const block = stepBlockContaining(workflow, "scripts/check-docs-brand.mts");

  it("门禁真的在 quality job 里跑", () => {
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    expect(block.join("\n")).toContain("run:");
  });

  it("step 没被 continue-on-error / if: 架空", () => {
    const text = block.join("\n");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("命令串完整（改名后留下的悬空引用不会假绿）", () => {
    expect(block.join("\n")).toContain("run: node --experimental-strip-types scripts/check-docs-brand.mts");
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:docs-brand"]).toContain("scripts/check-docs-brand.mts");
  });
});
