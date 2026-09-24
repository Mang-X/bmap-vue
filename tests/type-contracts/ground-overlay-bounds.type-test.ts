/**
 * `GroundOverlayProps.bounds` 的**类型面**契约（issue #136 评审 P2）
 *
 * #136 删掉 `startPoint` / `endPoint` 之后，`bounds` 是这个组件**唯一**的几何入口：
 * 运行时 `createGroundOverlaySpec().create()` 在缺 `bounds` 时直接抛错，文档也把它标成
 * `required`。类型层却还留着 `bounds?`——于是调用方能通过类型检查，只在挂载时炸。
 * 「类型说可选、运行时说必填」就是 AGENTS.md 禁止的**假支持**，必须收敛成一致。
 *
 * 为什么落在本目录而不是 `ground-overlay.test.ts`：`tsconfig.build.json` 排除 `src/` 下的 `*.test.ts`、
 * `tsconfig.tests.json` 只 include `tests/performance` 与 `tests/browser/live-performance`——
 * 放在 `tests/behavior/` 的类型断言**不会被任何 tsc 编译**，因此永远翻红不了。
 * #139 已经为同一类问题立了这个门禁（见 `tsconfig.type-contracts.json` 的注释），这里沿用同一形态。
 *
 * **判别力是双向的**：下面每条 `@ts-expect-error` 在「错误消失」时会变成 TS2578（unused）而翻红，
 * 所以把 `bounds` 改回可选（或退化成 `any`）本文件立刻红。正控则保证不是在「类型什么都能收」
 * 的前提下恒绿。
 *
 * 命名 `*.type-test.ts`：vitest 的 include 是 `*.test.ts`，本文件不含 `it()`，不该被当运行时用例收集。
 */
import type { GroundOverlayProps } from "../../packages/bmap-vue/src/types/components";

/** 最小合法几何：两个角点。 */
const bounds = {
  southwest: { lng: 116.3, lat: 39.8 },
  northeast: { lng: 116.5, lat: 40 },
};

// 正控：正典 props 确实被接受（否则下面全错只是因为导入坏了）
const _canonical: GroundOverlayProps = { bounds, type: "image", url: "a.png" };
void _canonical;

// 反例 1：缺 `bounds` 不再是合法 props —— 必填性的直接判定
// @ts-expect-error bounds 是唯一几何入口，缺失时构造期即抛错，类型层不得接受
const _missingBounds: GroundOverlayProps = { type: "image", url: "a.png" };
void _missingBounds;

// 反例 2：显式传 `undefined` 同样不合法（`exactOptionalPropertyTypes` 未开时这条尤其重要——
// 可选键**会**接受 `undefined`，必填键不会）
// @ts-expect-error bounds 是必填键，显式 undefined 必须在类型层被拒
const _explicitUndefined: GroundOverlayProps = { bounds: undefined, type: "image", url: "a.png" };
void _explicitUndefined;

// 正控：可选键仍然接受 `undefined`（证明上面两条不是「因为一切都拒收」）
const _optionalAcceptsUndefined: GroundOverlayProps = {
  bounds,
  type: "image",
  url: "a.png",
  opacity: undefined,
};
void _optionalAcceptsUndefined;

// 正控：同族里其他必填键（type / url）同样拒收缺失——防止「只有 bounds 被放宽」时本文件仍绿
// @ts-expect-error type 是必填键
const _missingType: GroundOverlayProps = { bounds, url: "a.png" };
void _missingType;
// @ts-expect-error url 是必填键
const _missingUrl: GroundOverlayProps = { bounds, type: "image" };
void _missingUrl;
