/**
 * 单测超时预算的门禁（#216）
 *
 * 为什么需要它：本票的修法是**一行配置**——根 `vitest.config.ts` 显式设 `testTimeout`。而这一类
 * 改动「改了没有任何用例会红」：把它删回 Vitest 默认的 5s，全套用例照样全绿（只是偶发超时又
 * 回来了），这正是 #216 要根治的形态。所以这里把**判据**钉住。
 *
 * 与 `tests/performance/config-consistency.perf.test.ts` 同一形态：**import 配置对象**比对，
 * 不做文本匹配——文本匹配在格式调整后假绿。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rootConfig from "../../vitest.config";

const rootTestTimeout = (rootConfig as { test?: { testTimeout?: number } }).test?.testTimeout;

/** Vitest 的默认 `testTimeout`——本票的起点，必须被显式覆盖，否则偶发超时原样回来。 */
const VITEST_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * 本仓最重的单条用例的**实测**耗时（本机 10 vCPU、`pnpm test:unit` 全量并行，2026-10-12）。
 *
 * 当时最慢的是 `api-forgotten-exports-gate` 的「现场起 TS 编译器查签名」（1204ms），其次是
 * `raw-sdk-scanner` 的 `--src` 全树扫描（1154ms）。改成更重的用例时应重新量并更新此值。
 */
const HEAVIEST_MEASURED_TEST_MS = 1_204;

/** 安全网相对实测最重用例的最小倍数：要能吸收 CI 相对本机的降速（#216 的实测结论是数倍）。 */
const MIN_HEADROOM_MULTIPLE = 10;

/**
 * **容量上限**（评审 P2）：本值是**安全网**，不是「允许卡住」。只锁下限会放过
 * `testTimeout: 3_600_000` / `Infinity`——那样一个挂死的用例能拖到 runner 超时，
 * 配置注释里「不会把卡死当作通过」就成了空话。60s 是「最重实测 × 50」，再往上就不再是安全网。
 */
const MAX_SAFETY_NET_MS = 60_000;

/** `test:unit` 必须走**根配置**的预算；命令行若自带 `--testTimeout` 会盖过它，让门禁假绿。 */
function testUnitScript(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return pkg.scripts?.["test:unit"] ?? "";
}

describe("单测超时预算的门禁（#216）", () => {
  it("根配置必须显式设 testTimeout，且不得回落到 Vitest 默认值", () => {
    expect(rootTestTimeout, "根配置必须显式设 testTimeout（#216 的修法）").toBeTypeOf("number");
    expect(
      rootTestTimeout,
      `testTimeout 不得是 Vitest 默认的 ${VITEST_DEFAULT_TIMEOUT_MS}ms：重活用例（现场类型检查 / ` +
        `扫整棵树 / 100 轮挂载）在 CI 上会再度偶发超时`,
    ).not.toBe(VITEST_DEFAULT_TIMEOUT_MS);
  });

  it("安全网落在 [下限, 上限] 区间内，而不是只验下限", () => {
    // 上限侧：`Infinity` / 超大值会让 `>= 下限` 恒真，先把「卡死也通过」这条路堵死。
    expect(Number.isFinite(rootTestTimeout), `testTimeout 必须是有限数（实际 ${rootTestTimeout}）`).toBe(
      true,
    );
    const floor = HEAVIEST_MEASURED_TEST_MS * MIN_HEADROOM_MULTIPLE;
    expect(
      rootTestTimeout,
      `testTimeout ${rootTestTimeout}ms 相对最重实测用例 ${HEAVIEST_MEASURED_TEST_MS}ms 余量不足 ` +
        `${MIN_HEADROOM_MULTIPLE} 倍（需要 ≥ ${floor}ms）`,
    ).toBeGreaterThanOrEqual(floor);
    expect(
      rootTestTimeout,
      `testTimeout ${rootTestTimeout}ms 超过安全网上限 ${MAX_SAFETY_NET_MS}ms：` +
        `那会把「卡死」当作「慢」，不再是安全网`,
    ).toBeLessThanOrEqual(MAX_SAFETY_NET_MS);
  });

  it("`test:unit` 不得用命令行参数盖过根配置的预算", () => {
    const script = testUnitScript();
    // 正证守卫：脚本取不到会让下面两条在空串上恒真。
    expect(script, "package.json#scripts.test:unit 必须存在").not.toBe("");
    expect(
      /--test[-]?timeout/i.test(script),
      `test:unit 自带 --testTimeout 会盖过根配置，让本门禁假绿：${script}`,
    ).toBe(false);
  });
});
