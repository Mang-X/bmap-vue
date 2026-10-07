#!/usr/bin/env node
/**
 * Volar 消费者门禁（issue #158 工作包 C）
 *
 * 按安装文档（`docs/zh-CN/guide/quick-start.md`「Volar 支持」）只配置
 * `compilerOptions.types: ["<pkg>/volar"]`，让 fixture 里的真实 `.vue` 模板在**没有本地
 * 组件 import** 的前提下拿到 `GlobalComponents` 类型，然后用 `vue-tsc` 跑两份探针：
 *
 * | 探针 | 期望 | 证明 |
 * | --- | --- | --- |
 * | `positive.vue` | 零诊断 | 合法 props / slots 可推导 |
 * | `negative.vue` | TS2322 + TS2339 | 组件类型真的生效、props/slots 没退化成 `any` |
 *
 * 探针刻意写成**只有 template 的 SFC**：「无本地 import」因此是结构保证（没有能写 import
 * 的 `<script>`），不需要去扫源码文本。
 *
 * 判据本体在 `consumer-volar-boundary.mts`（纯函数，可喂合成诊断做行为级反例）。
 *
 * 用法（由 `pnpm verify:package` 调用，参数是装好依赖的消费 fixture 目录）：
 *   node --experimental-strip-types scripts/consumer-volar.mts .artifacts/fixture-consumer
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { assertVolarReport, parseVolarDiagnostics } from "./consumer-volar-boundary.mts";

function runVueTsc(bin: string, cwd: string, project: string): string {
  console.log(`[consumer-volar] vue-tsc -p ${project}`);
  try {
    return execFileSync(bin, ["-p", project, "--noEmit"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // 有诊断时 vue-tsc 以非零退出；把 stdout 与 stderr 都并进来解析（**不**在这里判
    // 「非零就是通过」—— 判据是诊断的**代码与归属**，不是退出码）。
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
}

function main(): void {
  const fixtureDir = process.argv[2];
  if (fixtureDir === undefined) {
    throw new Error(
      "[consumer-volar] 用法：node --experimental-strip-types scripts/consumer-volar.mts <fixtureDir>\n" +
        "  fixtureDir 必须是**已经 npm install 过**的消费 fixture —— 判据要跑在真实 tarball 上。",
    );
  }
  const cwd = resolve(fixtureDir);
  const probeDir = resolve(cwd, "volar");
  const vueTsc = resolve(cwd, "node_modules/.bin/vue-tsc");
  if (!existsSync(vueTsc)) {
    throw new Error(`[consumer-volar] 找不到 vue-tsc：${vueTsc} —— 消费 fixture 还没装依赖？`);
  }
  for (const file of ["tsconfig.json", "tsconfig.negative.json", "positive.vue", "negative.vue"]) {
    if (!existsSync(resolve(probeDir, file))) {
      throw new Error(
        `[consumer-volar] 缺少判据输入：${resolve(probeDir, file)}\n` +
          `  探针是 fixture 的一部分（fixtures/consumer/volar/），缺失说明 fixture 没被完整复制。`,
      );
    }
  }

  const report = {
    positive: parseVolarDiagnostics(runVueTsc(vueTsc, probeDir, "tsconfig.json")),
    negative: parseVolarDiagnostics(runVueTsc(vueTsc, probeDir, "tsconfig.negative.json")),
  };
  assertVolarReport(report);
  console.log(
    `[consumer-volar] OK：无本地 import 的真实 .vue 模板经 \"types\": [\"<pkg>/volar\"] 拿到 ` +
      `GlobalComponents —— 正证零诊断；反证命中 ${report.negative.map((d) => `TS${d.code}`).join(" + ")}` +
      `（已有 prop 值类型写错、slot 成员不存在）`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
