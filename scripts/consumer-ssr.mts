#!/usr/bin/env node
/**
 * SSR 消费者门禁（issue #158 工作包 B）
 *
 * 在**纯 Node**里用 `@vue/compiler-sfc` 真实编译 `fixtures/consumer/ssr/App.vue`，
 * 执行编译产物，`renderToString` 渲染含 `<Map>` 的组件，然后按
 * `consumer-ssr-boundary.mts` 的判据核对取证报告。
 *
 * 跑**两个独立进程**，各自取证一件事（理由见 runner 文件头）：
 *
 * 1. `bare` —— 一个全局都不注入，忠实于真实消费者；证明「真实纯 Node 下能渲染」；
 * 2. `instrument` —— 注入记账 getter；证明「`document` 一次没读、渲染阶段零访问」。
 *
 * 判据本体在 boundary 模块（可喂合成报告做行为级反例）；这里只负责跑真实进程并把 JSON
 * 报告交给判据。runner 在消费 fixture 里（`ssr/ssr-runner.mjs`），所以它读到的是
 * **装出来的 tarball**与那份 fixture 的依赖，而不是仓库源码。
 *
 * 用法（由 `pnpm verify:package` 调用，参数是装好依赖的消费 fixture 目录）：
 *   node --experimental-strip-types scripts/consumer-ssr.mts .artifacts/fixture-consumer
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertBareSsrReport,
  assertInstrumentedSsrReport,
  type SsrReport,
} from "./consumer-ssr-boundary.mts";

const MODES = ["bare", "instrument"] as const;

function runMode(cwd: string, runner: string, mode: (typeof MODES)[number]): SsrReport {
  console.log(`[consumer-ssr] ${mode} 取证：通过 node 子进程渲染真实 SFC`);
  const output = execFileSync(process.execPath, [runner, mode], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lastLine = output.trim().split("\n").at(-1);
  if (lastLine === undefined || lastLine.length === 0) {
    throw new Error(`[consumer-ssr] ${mode} runner 没有输出 JSON 报告。`);
  }
  try {
    return JSON.parse(lastLine) as SsrReport;
  } catch {
    throw new Error(
      `[consumer-ssr] ${mode} runner 的最后一行不是 JSON：\n${lastLine.slice(0, 500)}`,
    );
  }
}

function main(): void {
  const fixtureDir = process.argv[2];
  if (fixtureDir === undefined) {
    throw new Error(
      "[consumer-ssr] 用法：node --experimental-strip-types scripts/consumer-ssr.mts <fixtureDir>\n" +
        "  fixtureDir 必须是**已经 npm install 过**的消费 fixture —— 判据要跑在真实依赖上。",
    );
  }
  const cwd = resolve(fixtureDir);
  const runner = resolve(cwd, "ssr/ssr-runner.mjs");
  if (!existsSync(runner)) {
    throw new Error(
      `[consumer-ssr] 找不到 runner：${runner}\n` +
        `  它是 fixture 的一部分（fixtures/consumer/ssr/），缺失说明 fixture 没被完整复制。`,
    );
  }
  if (!existsSync(resolve(cwd, "node_modules/vue"))) {
    throw new Error(
      `[consumer-ssr] ${cwd} 还没装依赖（缺 node_modules/vue）—— 先 npm install 再跑本门禁。`,
    );
  }

  const reports = new Map<(typeof MODES)[number], SsrReport>();
  for (const mode of MODES) {
    reports.set(mode, runMode(cwd, runner, mode));
  }
  const bare = reports.get("bare")!;
  const instrumented = reports.get("instrument")!;

  assertBareSsrReport(bare);
  assertInstrumentedSsrReport(instrumented);
  console.log(
    `[consumer-ssr] OK：真实 SFC 在纯 Node 里 renderToString —— 环境无 window/document` +
      `（typeof + in + hasOwn 三条都干净），容器 shell + idle/no-map，` +
      `document 读取 0 次、渲染阶段 DOM 访问 0 次，` +
      `import 阶段守卫式读取 = ${JSON.stringify(instrumented.importPhase)}，` +
      `loader=${bare.loaderStatus}，全局 BMap=undefined；` +
      `vue/server-renderer/compiler-sfc = ${bare.versions.vue}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
