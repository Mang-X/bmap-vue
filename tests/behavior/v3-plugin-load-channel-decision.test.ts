/**
 * `probe-plugin-load-channel` 判定函数的桩测试（issue #121）
 *
 * 判定是纯函数，因此可以用**合成报告**把每一条失效方式钉住 —— 这比「某一天真的跑真实浏览器」
 * 才暴露要可靠得多（#97 / #104 / #122 的教训）。本文件覆盖三类：
 *
 * 1. **健康基线必须是 `0`**：每条负例都先断言基线为 `0` 再改一个字段，否则「判定恒返回某个码」
 *    也能让用例通过；
 * 2. **缺读数落第三态（`3` blocked）而不是判成通过或失败**：「没测到」与「测到没问题」必须分开
 *    （本探针的字段级 presence 检查就是这么写的）；
 * 3. **前置读数不成立时整轮不可判定**：「脚本元素从未被观察到」时「零残留」恒真，这类断言必须
 *    有对应的正证读数当前置（`scriptsWhileHanging` / `scriptsDuringLoad`）。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decidePluginLoadChannelExitCode,
  formatPluginLoadChannelSummary,
  PLUGIN_LOAD_CHANNEL_SCENARIOS,
  type PluginLoadChannelRun,
} from "../../scripts/plugin-load-channel-report.mts";
import { BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS } from "../../packages/bmap-vue/src/plugins/builtins";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

/**
 * 一份「三个场景都符合契约」的报告。
 *
 * 取值刻意**照抄一次真实成功运行**（`BAIDU_MAP_AK=… pnpm probe:plugin-load-channel` 的读数）：
 * 内置工厂超时、`plugin-error` 在超时后约 30ms、脚本元素结算后归零、后一个插件 `attempts=1`。
 */
function healthyRuns(): PluginLoadChannelRun[] {
  return [
    {
      scenario: "control",
      env: { akPresent: true, sdkLoaded: true, canvasCount: 1, urlPatched: false },
      readings: {
        control: {
          events: [
            { name: null, type: "ready", atMs: 262, errorText: null },
            { name: "TrackAnimation", type: "plugin-ready", atMs: 465, errorText: null },
          ],
          mapReady: true,
          status: "ready",
          inspected: { TrackAnimation: { status: "ready", attempts: 1, consumers: 0 } },
          scriptCount: 1,
          globalExposed: true,
        },
      },
      done: true,
      fatal: null,
    },
    {
      scenario: "hang",
      env: {
        akPresent: true,
        sdkLoaded: true,
        canvasCount: 1,
        urlPatched: true,
        builtinPluginTimeoutMs: BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS,
      },
      readings: {
        hang: {
          events: [
            { name: null, type: "ready", atMs: 30, errorText: null },
            {
              name: "TrackAnimation",
              type: "plugin-error",
              atMs: BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS + 32,
              errorText:
                'plugin "TrackAnimation" 未加载成功（status: error） | cause: plugin load timed out after ' +
                BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS +
                "ms: /__hang/plugin-load-channel",
            },
          ],
          mapReady: true,
          mapReadyAtMs: 30,
          settledWithinWindow: true,
          hangSettledAtMs: BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS + 32,
          hangSettleType: "plugin-error",
          hangErrorText:
            "plugin load timed out after " + BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS + "ms: /__hang/plugin-load-channel",
          // 挂起期间（结算之前）：还在 loading、还有一个消费者在等
          inspectedWhileHanging: {
            TrackAnimation: { status: "loading", attempts: 1, consumers: 1 },
            GeoUtils: { status: "idle", attempts: 0, consumers: 0 },
          },
          // 结算之后：那是结论，不是「还在跑」
          inspected: {
            TrackAnimation: { status: "error", attempts: 1, consumers: 0 },
            GeoUtils: { status: "loading", attempts: 1, consumers: 1 },
          },
          scriptsWhileHanging: 1,
          hangScriptsAtEnd: 0,
          secondPluginAttempts: 1,
          secondPluginReady: false,
          status: "ready",
        },
      },
      done: true,
      fatal: null,
    },
    {
      scenario: "cancel",
      // 刻意与真实读数一致：`cancel` 场景不建图（也就不需要 SDK），判定层不得拿 SDK 当它的前置
      env: { akPresent: true, sdkLoaded: false, canvasCount: 0, urlPatched: true },
      readings: {
        cancel: {
          mapScopedAbort: {
            rejectedText: "plugin aborted",
            scriptsDuringLoad: 1,
            scriptsAfterAbort: 0,
          },
          sharedHost: {
            entryBeforeCancel: { status: "loading", attempts: 1, consumers: 2 },
            scriptsBeforeCancel: 1,
            aRejectedText: 'plugin "TrackAnimation" wait aborted | cause: signal is aborted without reason',
            entryAfterACancel: { status: "loading", attempts: 1, consumers: 1 },
            scriptsAfterACancel: 1,
            bSettledBeforeDispose: false,
            bTextBeforeDispose: null,
            bRejectedTextAfterDispose: 'plugin "TrackAnimation" wait aborted',
            entryAfterDispose: null,
            scriptsAfterDispose: 0,
          },
        },
      },
      done: true,
      fatal: null,
    },
  ];
}

/** 按场景取读数块（找不到时返回 `{}`，让「缺块」的用例自己造）。 */
function readingsOf(runs: PluginLoadChannelRun[], scenario: string): Record<string, unknown> {
  const run = runs.find((candidate) => candidate.scenario === scenario);
  const bag = run?.readings as Record<string, unknown> | undefined;
  return (bag?.[scenario] ?? {}) as Record<string, unknown>;
}

function runOf(runs: PluginLoadChannelRun[], scenario: string): PluginLoadChannelRun {
  return runs.find((candidate) => candidate.scenario === scenario)!;
}

/** 改一个字段并判定（保留其余场景健康）。 */
function decideWith(
  scenario: string,
  mutate: (readings: Record<string, unknown>, run: PluginLoadChannelRun) => void,
): ReturnType<typeof decidePluginLoadChannelExitCode> {
  const runs = healthyRuns();
  const readings = readingsOf(runs, scenario);
  mutate(readings, runOf(runs, scenario));
  const bag = runOf(runs, scenario).readings as Record<string, unknown>;
  bag[scenario] = readings;
  return decidePluginLoadChannelExitCode(runs);
}

describe("[#121] 插件加载通道探针的判定", () => {
  it("健康报告 ⇒ 0（基线；下面的负例都相对它改一个字段）", () => {
    const decision = decidePluginLoadChannelExitCode(healthyRuns());
    expect(decision.reasons).toEqual([]);
    expect(decision.exitCode).toBe(0);
    expect(decision.counts).toMatchObject({
      runs: 3,
      expected: 3,
      settledWithinWindow: 1,
      secondPluginRequested: 1,
    });
  });

  it("场景清单为空 ⇒ 2（防空转：没有期望就没有判定）", () => {
    expect(decidePluginLoadChannelExitCode(healthyRuns(), []).exitCode).toBe(2);
  });

  it("缺某个场景的报告 ⇒ 2（脚手架失败，不得过滤掉）", () => {
    const runs = healthyRuns().filter((run) => run.scenario !== "cancel");
    const decision = decidePluginLoadChannelExitCode(runs);
    expect(decision.exitCode).toBe(2);
    expect(decision.reasons.join(" ")).toContain("cancel");
  });

  it("页面脚本自身抛错 ⇒ 2", () => {
    const runs = healthyRuns();
    runOf(runs, "hang").fatal = "boom";
    expect(decidePluginLoadChannelExitCode(runs).exitCode).toBe(2);
  });

  it("缺 AK ⇒ 3（blocked，不是通过）", () => {
    const runs = healthyRuns();
    runOf(runs, "control").env!.akPresent = false;
    expect(decidePluginLoadChannelExitCode(runs).exitCode).toBe(3);
  });

  it("需要 SDK 的场景里 SDK 没起来 ⇒ 3", () => {
    const runs = healthyRuns();
    runOf(runs, "hang").env!.sdkLoaded = false;
    expect(decidePluginLoadChannelExitCode(runs).exitCode).toBe(3);
  });

  it("cancel 场景不需要 SDK：sdkLoaded=false 不得把它判成 blocked（正证守卫）", () => {
    // 这条是判定层第一版真实踩过的坑：`cancel` 场景刻意不建图，拿 SDK 当它的前置会把
    // 「通道能不能取消」与「SDK 能不能起来」混成一件事，整轮永远 blocked（假红）。
    const runs = healthyRuns();
    expect(runOf(runs, "cancel").env!.sdkLoaded).toBe(false);
    expect(decidePluginLoadChannelExitCode(runs).exitCode).toBe(0);
  });

  it("地图夹具没建成（canvas 缺失或为 0）⇒ 3", () => {
    for (const canvasCount of [0, undefined]) {
      const runs = healthyRuns();
      (runOf(runs, "control").env as Record<string, unknown>).canvasCount = canvasCount;
      const decision = decidePluginLoadChannelExitCode(runs);
      expect(decision.exitCode, `canvasCount=${String(canvasCount)} 应当落 blocked`).toBe(3);
      expect(decision.reasons.join(" ")).toContain("地图夹具");
    }
  });

  it("control：真实 URL 没有就绪且错误文本是「没暴露全局」⇒ 1（通道契约）", () => {
    const decision = decideWith("control", (readings) => {
      readings.events = [
        { name: "TrackAnimation", type: "plugin-error", atMs: 900, errorText: "plugin did not expose export: https://x" },
      ];
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("没有暴露全局");
  });

  it("control：真实 URL 没就绪但错误像网络波动 ⇒ 3（blocked，不是库回归）", () => {
    const decision = decideWith("control", (readings) => {
      readings.events = [
        { name: "TrackAnimation", type: "plugin-error", atMs: 900, errorText: "failed to load plugin: https://x" },
      ];
    });
    expect(decision.exitCode).toBe(3);
  });

  it("control：真实插件就绪但地图没 ready ⇒ 1", () => {
    expect(decideWith("control", (readings) => { readings.mapReady = false; }).exitCode).toBe(1);
  });

  it("control：缺 mapReady 读数 ⇒ 3（不得把「没测到」读成没问题）", () => {
    expect(decideWith("control", (readings) => { delete readings.mapReady; }).exitCode).toBe(3);
  });

  it("hang：挂起期间地图没 ready ⇒ 1（插件不得阻断地图 ready）", () => {
    expect(decideWith("hang", (readings) => { readings.mapReady = false; }).exitCode).toBe(1);
  });

  it("hang：窗口内没有结算（永久挂起）⇒ 1 —— 这正是本票要修的缺陷形态", () => {
    const decision = decideWith("hang", (readings) => {
      readings.settledWithinWindow = false;
      readings.hangSettledAtMs = null;
      readings.hangSettleType = null;
      readings.hangErrorText = null;
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("永久挂起");
  });

  it("hang：以 plugin-ready 结算（把挂起当成功）⇒ 1", () => {
    expect(decideWith("hang", (readings) => { readings.hangSettleType = "plugin-ready"; }).exitCode).toBe(1);
  });

  it("hang：失败原因不可归类为超时 ⇒ 1（没有排查抓手）", () => {
    expect(
      decideWith("hang", (readings) => { readings.hangErrorText = "failed to load plugin: https://x"; }).exitCode,
    ).toBe(1);
  });

  it("hang：缺 hangErrorText 读数 ⇒ 3（缺读数落第三态，不是判失败）", () => {
    expect(decideWith("hang", (readings) => { delete readings.hangErrorText; }).exitCode).toBe(3);
  });

  it("hang：结算时刻明显早于配置的超时 ⇒ 1（说明不是超时在起作用）", () => {
    const decision = decideWith("hang", (readings) => {
      readings.hangSettledAtMs = 100;
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("早于配置的超时");
  });

  it("hang：结算后仍残留永不响应的脚本元素 ⇒ 1", () => {
    expect(decideWith("hang", (readings) => { readings.hangScriptsAtEnd = 1; }).exitCode).toBe(1);
  });

  it("hang：挂起期间注册表状态不是 loading ⇒ 1", () => {
    const decision = decideWith("hang", (readings) => {
      readings.inspectedWhileHanging = {
        TrackAnimation: { status: "error", attempts: 1, consumers: 0 },
      };
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("而不是 loading");
  });

  it("hang：挂起期间没有消费者在等 ⇒ 1", () => {
    expect(
      decideWith("hang", (readings) => {
        readings.inspectedWhileHanging = {
          TrackAnimation: { status: "loading", attempts: 1, consumers: 0 },
        };
      }).exitCode,
    ).toBe(1);
  });

  it("hang：缺挂起期间的 inspect 读数 ⇒ 3（缺读数落第三态）", () => {
    expect(decideWith("hang", (readings) => { delete readings.inspectedWhileHanging; }).exitCode).toBe(3);
  });

  it("hang：结算后注册表状态不是 error ⇒ 1", () => {
    const decision = decideWith("hang", (readings) => {
      readings.inspected = {
        TrackAnimation: { status: "loading", attempts: 1, consumers: 1 },
        GeoUtils: { status: "idle", attempts: 0, consumers: 0 },
      };
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("而不是 error");
  });

  it("hang：后面的插件从未被请求 ⇒ 1（顺序 await 被永久阻塞）", () => {
    expect(decideWith("hang", (readings) => { readings.secondPluginAttempts = 0; }).exitCode).toBe(1);
  });

  it("hang：脚本元素从未被观察到 ⇒ 3（前置不成立，「零残留」会恒真）", () => {
    const decision = decideWith("hang", (readings) => {
      readings.scriptsWhileHanging = 0;
    });
    expect(decision.exitCode).toBe(3);
    expect(decision.reasons.join(" ")).toContain("恒真");
  });

  it("hang：URL 没有被指向不响应的地址 ⇒ 3（读数不可用）", () => {
    const runs = healthyRuns();
    runOf(runs, "hang").env!.urlPatched = false;
    expect(decidePluginLoadChannelExitCode(runs).exitCode).toBe(3);
  });

  it("cancel：abort 之后没摘脚本 ⇒ 1", () => {
    expect(
      decideWith("cancel", (readings) => {
        (readings.mapScopedAbort as Record<string, unknown>).scriptsAfterAbort = 1;
      }).exitCode,
    ).toBe(1);
  });

  it("cancel：加载期间没有观察到脚本 ⇒ 3（前置不成立）", () => {
    expect(
      decideWith("cancel", (readings) => {
        (readings.mapScopedAbort as Record<string, unknown>).scriptsDuringLoad = 0;
      }).exitCode,
    ).toBe(3);
  });

  it("cancel：取消一个消费者之后消费者数变成 0 或 2 ⇒ 1（取消波及别人 / 没解绑自己）", () => {
    for (const consumers of [0, 2]) {
      const decision = decideWith("cancel", (readings) => {
        (readings.sharedHost as Record<string, unknown>).entryAfterACancel = {
          status: "loading",
          attempts: 1,
          consumers,
        };
      });
      expect(decision.exitCode, `consumers=${consumers} 应当判失败`).toBe(1);
    }
  });

  it("cancel：取消一个消费者之后共享脚本被摘掉 ⇒ 1（消费者取消不得终止共享加载）", () => {
    const decision = decideWith("cancel", (readings) => {
      (readings.sharedHost as Record<string, unknown>).scriptsAfterACancel = 0;
    });
    expect(decision.exitCode).toBe(1);
    expect(decision.reasons.join(" ")).toContain("不得终止共享加载");
  });

  it("cancel：未取消的消费者在宿主 dispose 之前就被结算 ⇒ 1（被别人的取消带走）", () => {
    expect(
      decideWith("cancel", (readings) => {
        (readings.sharedHost as Record<string, unknown>).bSettledBeforeDispose = true;
      }).exitCode,
    ).toBe(1);
  });

  it("cancel：宿主 dispose 之后仍残留脚本 ⇒ 1", () => {
    expect(
      decideWith("cancel", (readings) => {
        (readings.sharedHost as Record<string, unknown>).scriptsAfterDispose = 1;
      }).exitCode,
    ).toBe(1);
  });

  it("cancel：缺 sharedHost 读数 ⇒ 3（缺读数落第三态）", () => {
    expect(decideWith("cancel", (readings) => { delete readings.sharedHost; }).exitCode).toBe(3);
  });

  it("汇总行带上各计数（便于在日志里一眼看出判据落在哪一步）", () => {
    const line = formatPluginLoadChannelSummary(decidePluginLoadChannelExitCode(healthyRuns()));
    for (const key of ["exit=0", "runs=3", "settledWithinWindow=1", "secondPluginRequested=1"]) {
      expect(line).toContain(key);
    }
  });

  it("期望的场景清单就是探针真正跑的三个（防两处漂移）", () => {
    expect([...PLUGIN_LOAD_CHANNEL_SCENARIOS]).toEqual(["control", "hang", "cancel"]);
    expect(healthyRuns().map((run) => run.scenario)).toEqual([...PLUGIN_LOAD_CHANNEL_SCENARIOS]);
  });

  it("合成报告的读数与真实运行的关键字段一致（超时结算 + 归零）", () => {
    // 正证守卫：如果哪天有人把健康报告改成「永远成立」的形状，这条会先红
    const healthy = readingsOf(healthyRuns(), "hang");
    expect(healthy.hangSettledAtMs as number).toBeGreaterThanOrEqual(BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS);
    expect(healthy.hangScriptsAtEnd).toBe(0);
    expect(healthy.scriptsWhileHanging).toBe(1);
  });
});

/**
 * 门禁最容易死在「它根本不存在」上（#74 的教训）：文档与 nightly 注释都写了这条探针，
 * 却可能没有任何 workflow 真的跑它，或者 step 被 `if:` / `continue-on-error:` 架空。
 */
describe("[#121] nightly 真的在跑插件加载通道探针", () => {
  const NIGHTLY = "nightly-v4-smoke.yml";

  /** 切出 job 段（跨 job 取首个匹配会把归属弄错）。 */
  function jobLines(text: string, job: string): string[] {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line === `  ${job}:`);
    expect(start, `找不到 ${job} job 段`).toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end);
  }

  it("nightly 有一个跑 `probe:plugin-load-channel` 的独立 job，且没被 if / continue-on-error 架空", () => {
    const text = readWorkflow(NIGHTLY);
    const job = jobLines(text, "plugin-load-channel");
    expect(job.length, "切空了 job 段，下面的断言会恒真").toBeGreaterThan(3);

    // 定位式锚到 token 边界：`/probe:plugin-load-channel/` 会被
    // `probe:plugin-load-channel-x` 满足，反证就成了空断言
    const locateRun = (lines: readonly string[]): number =>
      lines.findIndex((line) => /^\s*run:\s*.*probe:plugin-load-channel(\s|$)/.test(line));
    expect(locateRun(job), "job 里没有跑 probe:plugin-load-channel").toBeGreaterThanOrEqual(0);

    const step = stepBlockContaining(text, "probe:plugin-load-channel");
    expect(step.length, "没有切出 step 区块，架空检查无从判断").toBeGreaterThan(0);
    expect(step.some((line) => /^\s*-\s/.test(line))).toBe(true);
    expect(step.filter((line) => /^\s*(if|continue-on-error):/.test(line))).toEqual([]);
    // runner 上探针的浏览器默认候选是 macOS 路径，不给 SMOKE_BROWSER 会退 2「浏览器不存在」
    expect(step.some((line) => /^\s*SMOKE_BROWSER:\s*\S+/.test(line))).toBe(true);
    // job 级 if 必须是完整的 owner/repo（fork 上没有 secret）
    expect(
      job.some((line) => /^\s*if:\s*github\.repository == 'Mang-X\/bmap-vue'/.test(line)),
      "job 缺少完整 owner/repo 的 if 守卫（fork 上没有 secret）",
    ).toBe(true);

    // 反证：同一条定位式在改名后必须找不到
    const renamed = job.map((line) => line.replace("probe:plugin-load-channel", "probe:plugin-load-channel-x"));
    expect(locateRun(renamed)).toBe(-1);
  });

  it("根 scripts 里真的有这条命令（防空口承诺）", () => {
    // 断言「命令存在」而不是「名字出现在某处」：脚本名写错时 nightly 会红成脚手架失败。
    // ⚠️ 路径用 `process.cwd()`（vitest 的 root 就是仓库根），**不要**用 `import.meta.url`：
    // Vite 会把模块 id 改写成 `/@fs/…`，`new URL(...)` 拿到的不是 file: scheme。
    const scripts = (
      JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts["probe:plugin-load-channel"]).toContain("scripts/probe-plugin-load-channel.mts");
    expect(existsSync(join(process.cwd(), "scripts/probe-plugin-load-channel.mts"))).toBe(true);
  });
});
