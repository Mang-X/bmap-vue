/**
 * `Panorama.capture()` / `Panorama.clearOverlays()` 的**类型面**契约（issue #171 item I）
 *
 * 运行时行为（命令真的打到 SDK、`capture` 交回 Fake 的 data URL、已释放时抛
 * `BMAP_RESOURCE_DISPOSED`）由 `tests/behavior/panorama-capture-clear.test.ts` 钉住；
 * 本文件钉的是**声明面**。
 *
 * 为什么落在本目录而不是 `*.test.ts`：`tsconfig.tests.json` 只 include
 * `tests/performance` 与 `tests/browser/live-performance`，写在 `tests/behavior/` 的
 * `@ts-expect-error` **不会被任何 tsc 编译**，因此永远翻红不了（判别力为零）。
 *
 * **判别力双向**：每条 `@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红。
 */
import type { PanoramaCaptureOptions } from "../../packages/bmap-vue/src/index";

/** 严格相等（不是互相可赋值——那会放过 `{quality?: number} ⊆ Options` 这类假绿）。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
function expectTrue<T extends true>(_value?: T): void {}

// 1. options 逐键照抄官方内联的 `{ quality?: number; type?: string }`——
//    **不多给**第三个键（不引上游类型包 = 形状就是抄来的，不维护逃生口）。
expectTrue<Equals<PanoramaCaptureOptions, { quality?: number; type?: string }>>();

// 2. 官方没有 `format` 键。
// @ts-expect-error 官方没有第三个选项键
const bad: PanoramaCaptureOptions = { format: "webp" };
void bad;

// 3. `quality` 是 `number`，不接受 `null`——官方那条「不支持截图」是**返回**不是入参。
// @ts-expect-error quality 是 `number | undefined`，不接受 `null`
const badNull: PanoramaCaptureOptions = { quality: null };
void badNull;

// 4. `type` 是 `string`（MIME），不接受枚举字面量。
// @ts-expect-error type 是 `string`，不是某个枚举
const badType: PanoramaCaptureOptions = { type: 1 };
void badType;

// 5. 返回口径：读取面统一 `string | null`（官方声明的 `undefined` 已被 Driver 归一成 `null`），
//    而 `clearOverlays` 是**写**命令（返回 `void`，不是 `boolean` 也不是 `string | null`）。
//    这两条只能从 `<Panorama>` 的 expose 上读到，见下一条断言的类型来源。
declare const exposed: {
  capture: (options?: PanoramaCaptureOptions) => string | null;
  clearOverlays: () => void;
};
expectTrue<Equals<ReturnType<typeof exposed.capture>, string | null>>();
expectTrue<Equals<ReturnType<typeof exposed.clearOverlays>, void>>();

// 6. `capture` 的 options 是**可选**的：官方 `capture(options?)`，本库不得改成必填。
expectTrue<Equals<Parameters<typeof exposed.capture>["length"], 0 | 1>>();
expectTrue<Equals<Parameters<typeof exposed.clearOverlays>, []>>();
