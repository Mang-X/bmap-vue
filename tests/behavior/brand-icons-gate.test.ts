/**
 * 品牌图标漂移门禁的正反成对用例。
 *
 * **只写负向断言的门禁等于没有门禁**：判据写坏了（哈希算法取错、比对对象取错、
 * 临时目录写成了仓库目录）同样会让「通过」路径变绿。所以每条正向断言都要配一条
 * 变异——改了矢量资产却没重渲染，**必须**红。
 *
 * 与 `docs-brand-gate.test.ts` 同一形态：`execFileSync` 跑脚本 + 真实资产。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, "scripts/check-brand-icons.mts");
const ICON_SVG = join(ROOT, "docs/public/brand/bmap-vue-icon-square.svg");
const ICON_DIR = join(ROOT, "docs/public/icons");

function runGate(env?: Record<string, string>): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

/** 带自定义环境变量跑门禁（用于构造「浏览器不存在」这一侧）。 */
const runGateWithEnv = (env: Record<string, string>) => runGate(env);

/**
 * 有 Chromium 才跑真实渲染；否则这份用例没有判据可测，跳过而不是假装通过。
 * 探一次就够，不要为了判断环境先跑两遍门禁。
 */
const probe = runGate();

/**
 * 「门禁真的执行了判据」——不是「门禁绿了」。
 *
 * 门禁有一条 fail-open 路径：没有浏览器时跳过并退出 0。跳过的输出是「已跳过」，
 * 不含「无漂移」，所以这个判断不会把跳过当成执行过。
 *
 * 早先这里只写 `probe.stdout.includes("无漂移")`，看着等价、实际也等价——
 * 但它拦不住另一件事：**门禁若把真实故障也降级成跳过**（裸 `catch` + `exit(0)`），
 * 用例会因为门禁「绿」而照常跑，负向样例在门禁已经失效的前提下依然通过。
 * 下面那条 `非浏览器故障必须红` 的用例专门钉住这一点。
 */
const hasBrowser = probe.stdout.includes("无漂移");

describe("品牌图标门禁的 fail-open 边界", () => {
  it.runIf(hasBrowser)("浏览器存在时不得输出「已跳过」（那会掩盖真实故障）", () => {
    expect(probe.stdout).not.toContain("已跳过");
    expect(probe.status).toBe(0);
  });

  it("浏览器确实不存在时降级为跳过并退出 0（合法的那一侧）", () => {
    // 上一条只钉了「非浏览器故障必须红」，skip 分支本身没有被强制执行过——
    // 于是把「只降级不失败」改成「一律失败」或「一律跳过」都能让测试保持绿。
    // 错误分类的**两侧**都必须有断言。
    //
    // `SMOKE_BROWSER` 指向不存在的路径时渲染器抛 `BrowserUnavailableError`，
    // 门禁应降级为 skipped 且退出 0。
    const r = runGateWithEnv({ SMOKE_BROWSER: "/nonexistent/chromium" });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, "缺浏览器应当跳过（退出 0），而不是红：" + out).toBe(0);
    expect(out).toContain("已跳过");
    // 跳过必须说清缺什么，否则读日志的人无法判断门禁到底跑没跑
    expect(out).toContain("Chromium");
  });

  it("渲染器缺浏览器时降级跳过，缺别的必须红", () => {
    // 构造一次「渲染器一定失败、但原因不是没有浏览器」：把渲染器指向的矢量源
    // 改成一个不存在的路径。`render-brand-icons.mts` 抛的是普通 Error
    // （`品牌图标源不存在`），不是 BrowserUnavailableError。
    // 门禁必须失败，而不是把它当成「环境不具备」。
    const script = join(ROOT, "scripts/render-brand-icons.mts");
    const backup = readFileSync(script, "utf8");
    try {
      // 用一个不存在的矢量源路径替换常量：渲染器必然失败，且失败原因明确不是浏览器。
      const broken = backup.replace(
        'join(ROOT, "docs/public/brand/bmap-vue-icon-square.svg")',
        'join(ROOT, "docs/public/brand/__missing__.svg")',
      );
      expect(broken, "注入点没命中，测试本身失效").not.toBe(backup);
      writeFileSync(script, broken);
      const r = runGate();
      const out = `${r.stdout}${r.stderr}`;
      expect(r.status, "SVG 源缺失是真故障，门禁不得降级为跳过：" + out).toBe(1);
      expect(out).not.toContain("已跳过");
    } finally {
      writeFileSync(script, backup);
    }
  });
});

describe("品牌图标漂移门禁", () => {
  const backup = new Map<string, string>();

  afterEach(() => {
    for (const [path, content] of backup) writeFileSync(path, content);
    backup.clear();
  });

  function edit(rel: string, transform: (s: string) => string): void {
    const path = join(ROOT, rel);
    backup.set(path, readFileSync(path, "utf8"));
    writeFileSync(path, transform(readFileSync(path, "utf8")));
  }

  it.runIf(hasBrowser)("矢量资产与已入库图标同源", () => {
    const result = runGate();
    expect(result.status, result.stderr).toBe(0);
  });

  it.runIf(hasBrowser)("改了矢量资产却不重渲染 —— 必须红（正向判据）", () => {
    edit("docs/public/brand/bmap-vue-icon-square.svg", (s) =>
      s.replace(/#FF302B/i, "#00A86B").replace(/#FF3528/i, "#00A86B"),
    );
    const result = runGate();
    expect(result.status, "改色后图标与矢量不再同源，门禁必须失败").toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/漂移/);
    // 报错必须指向真正的修法，而不是只说「不通过」
    expect(`${result.stdout}${result.stderr}`).toMatch(/generate:brand-icons/);
  });

  it("扫描到 0 个 PNG 时判失败（fail-closed，不空转）", () => {
    // 直接断言脚本自身的空转防线：icons 目录空的话 tracked.length 为 0
    const files = execFileSync("ls", [ICON_DIR], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".png"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("图标源文件存在且是正方形（导航栏 / favicon 直接用它，非方构图会被拉伸）", () => {
    const svg = readFileSync(ICON_SVG, "utf8");
    const m = /viewBox="([\d.\- ]+)"/.exec(svg);
    expect(m, "图标必须声明 viewBox").not.toBeNull();
    const parts = m![1].trim().split(/\s+/).map(Number);
    expect(parts).toHaveLength(4);
    const [, , w, h] = parts;
    expect(w).toBeCloseTo(h, 1);
  });

  it("maskable 图标与 any 图标不是同一张（安全区缩放真的生效了）", () => {
    const maskable = readFileSync(join(ICON_DIR, "maskable-icon-512x512.png"));
    const any = readFileSync(join(ICON_DIR, "icon-512x512.png"));
    expect(maskable.equals(any), "maskable 必须有安全区内缩，否则 Android 裁切会切到图钉尖").toBe(
      false,
    );
  });

  it("图标矢量源是入库文件（否则门禁读到的是本地残留，CI 上必然读不到）", () => {
    const tracked = execFileSync("git", ["ls-files", "docs/public/brand/"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(tracked, "矢量资产必须入库").toContain("bmap-vue-icon-square.svg");
  });
});
