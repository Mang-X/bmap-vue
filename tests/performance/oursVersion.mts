/**
 * 读**本库**版本号的唯一出处。
 *
 * ⚠️ 此前这段 `try { JSON.parse(readFileSync(...)) } catch { "unknown" }` 在四处逐字重复
 * （`collect-bundle-contrast.mts` / `collect-official-contrast-live.mts` / `collect-official-contrast.mts`
 * 的报告侧 / `official-contrast.perf.test.ts` 的 `readVersion`）。副本漂移**不会**让任何门禁变红——
 * 改了一处、另外三处照样编译通过——而「本库版本」是报告信封里用来自证「跑的是哪一版候选」的字段，
 * 几处不一致时报告就没有自称的东西了。
 *
 * 放在 `tests/performance/` 下（脚本与基准都能 import），而不是 `scripts/`：这层
 * `--experimental-strip-types` 的导入是**路径 + 扩展名**敏感的，放哪儿都会有人用错后缀，
 * 与其分两份放错，不如一份放在两边都已经引用的目录里。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 本库 `package.json` 的路径（相对仓库根）。 */
export const OURS_MANIFEST = "packages/bmap-vue/package.json";

/** 票面锁定的官方基线版本：偏离它就不是这次对照。 */
export const OFFICIAL_BASELINE_VERSION = "1.0.1";

/**
 * 读本库版本；读不到给 `unknown` 而不是抛。
 *
 * 报告要能自证「跑的是哪一版候选」，所以这里**不能**因为 `package.json` 缺失就让整轮崩掉
 * ——但也**不能**把失败静默成某个具体版本号。`unknown` 是诚实的「不知道」，
 * 而它会出现在报告里被人看见。
 */
export function readOursVersion(repoRoot: string): string {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(repoRoot, OURS_MANIFEST), "utf8"),
    ) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
