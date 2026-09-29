/**
 * 五条视野命令的 `options` 的**类型面**契约（issue #171 / #165 裁决 F）。
 *
 * ## 钉住什么
 *
 * 此前 `setCenter` / `setZoom` / `setHeading` / `setTilt` / `panTo` 五条全是 `(value)`——
 * 官方声明的 `options`（`noAnimation` / `callback`，`setZoom` 另有 `zoomCenter`、
 * `panTo` 另有 `duration`）在本库**完全不可达**。最直接的后果是：调用方永远无法知道一条
 * 视野命令什么时候真正落定。
 *
 * 本文件逐条把**官方声明的形状**与**「本库不收的」**同时钉住。逐条依据（改之前核对 d.ts 原文）：
 *
 * | 命令 | 官方声明（`@baidumap/jsapi-v4-types@4.0.4` 的 `core/Map.d.ts`） | 领域类型 |
 * | --- | --- | --- |
 * | `setCenter` | `setCenter(center: Point \| string, options?: { noAnimation?; callback? })` `:660` | `ViewCommandOptions` |
 * | `setZoom` | `setZoom(zoom: number, options?: { noAnimation?; callback?; zoomCenter? })` `:698` | `SetZoomOptions` |
 * | `setHeading` | `setHeading(heading: number, options?: { noAnimation?; callback? })` `:129` | `ViewCommandOptions` |
 * | `setTilt` | `setTilt(tilt: number, options?: { noAnimation?; callback? })` `:163` | `ViewCommandOptions` |
 * | `panTo` | `panTo(center: Point, options?: { noAnimation?; duration?; callback? })` `:591` | `PanToOptions` |
 *
 * ⚠️ **逐条不同的选项集**：官方对每条命令**单独**声明它的 options，`setZoom` 有 `zoomCenter`
 * 而 `setCenter` 没有，`panTo` 有 `duration` 而其余四条没有。共享一个类型必须**按官方逐条**——
 * 本库的做法是四条共用 `ViewCommandOptions`（官方在那四处声明的是**逐字相同**的形状），
 * 两个有独有成员的命令各自继承。下面的反例把「不该在的那条上有它」钉死。
 *
 * ⚠️ **不是 `<Map>` 的 prop**：官方**没有** `MapOptions.noAnimation`（#165 Class 5 据此删掉了
 * `MapProps.noAnimation`）。它只作为**逐调用**选项存在，做成组件级 prop 等于让一个开关决定之后
 * 所有命令的动画。见 `class5-removed-members.type-test.ts`。
 *
 * ## 判别力是双向的
 *
 * 每条 `@ts-expect-error` 在「错误消失」时变成 TS2578（unused）而翻红，所以把任一签名改回
 * `(value)`、或把类型放宽成 `any`，本文件立刻红。正控则保证不是在「类型什么都能收」的前提下
 * 恒绿。
 *
 * ## 为什么落在本目录
 *
 * 见 `tsconfig.type-contracts.json` 与 `ground-overlay-bounds.type-test.ts`：放在
 * `tests/behavior/` 的类型断言**不会被任何 tsc 编译**，因此永远翻红不了。
 * 命名 `*.type-test.ts`：vitest 的 include 是 `*.test.ts`，本文件不含 `it()`。
 */
import type { MapCommands } from "../../packages/bmap-vue/src/core/runtime/mapCommands";
import type { MapDriver } from "../../packages/bmap-vue/src/driver/types/map";
import type {
  PanToOptions,
  SetZoomOptions,
  ViewCommandOptions,
} from "../../packages/bmap-vue/src/driver/types/map";

declare const commands: MapCommands;
declare const driver: MapDriver;

/** 最小合法回调（官方 callback 的形状是零参）。 */
const noop = (): void => {};

/* ------------------------------------------------------------------ 正控 */

// 正控：官方声明的每个成员都被接受（否则下面全错只是因为类型收得太紧）
commands.setCenter({ lng: 1, lat: 1 }, { noAnimation: true, callback: noop });
commands.setCenter("北京", { noAnimation: false, callback: noop });
commands.setZoom(3, { noAnimation: true, callback: noop, zoomCenter: { lng: 1, lat: 1 } });
commands.setHeading(45, { noAnimation: true, callback: noop });
commands.setTilt(30, { noAnimation: true, callback: noop });
commands.panTo({ lng: 1, lat: 1 }, { noAnimation: true, duration: 300, callback: noop });

// 正控：不传 options 仍然是合法调用（新增的可选参数不能把既有调用弄坏）
commands.setCenter({ lng: 1, lat: 1 });
commands.setZoom(3);
commands.setHeading(45);
commands.setTilt(30);
commands.panTo({ lng: 1, lat: 1 });

// 正控：Driver 侧同样收下（命令面不是唯一入口）
driver.setCenter({} as never, { lng: 1, lat: 1 }, { noAnimation: true, callback: noop });
driver.setZoom({} as never, 3, { zoomCenter: { lng: 1, lat: 1 }, callback: noop });
driver.setHeading({} as never, 45, { noAnimation: true });
driver.setTilt({} as never, 30, { callback: noop });
driver.panTo({} as never, { lng: 1, lat: 1 }, { duration: 300, callback: noop });

/* ------------------------------------------- 反例 1：签名真的收下了第三个参数（红阶段的判据） */

/**
 * 反例的作用：把「参数真的存在」钉死。
 *
 * ⚠️ 下面这些**不能**用 `@ts-expect-error`——它们在当前形状下是**合法**的（options 可选）。
 * 它们的作用是「如果哪天有人把 `options` 删回去，下面这批会立刻红」；删回去时 TS 的报错是
 * 「Expected 1-2 arguments, but got 3」，与本文件里的 `@ts-expect-error` 无关。
 */

// 正控方向：传了第三个参数就是合法的（本行**必须**编过）
commands.setHeading(45, { noAnimation: true });
commands.setTilt(30, { noAnimation: true });
commands.setZoom(3, { noAnimation: true });
commands.panTo({ lng: 1, lat: 1 }, { noAnimation: true });
commands.setCenter({ lng: 1, lat: 1 }, { noAnimation: true });

/* --------------------------------------- 反例 2：逐条命令的选项集是各自的（官方逐条声明） */

// @ts-expect-error setZoom 有 zoomCenter，但 `duration` 是 panTo 独有的（Map.d.ts:591 vs :698）
const _zoomDuration: SetZoomOptions = { duration: 300 };
void _zoomDuration;

// @ts-expect-error `duration` 不在 `setCenter` 的官方声明里（Map.d.ts:660 只有两个成员）
commands.setCenter({ lng: 1, lat: 1 }, { duration: 300 });

// @ts-expect-error `duration` 不在 `setHeading` 的官方声明里（Map.d.ts:129）
commands.setHeading(45, { duration: 300 });

// @ts-expect-error `duration` 不在 `setTilt` 的官方声明里（Map.d.ts:163）
commands.setTilt(30, { duration: 300 });

// @ts-expect-error `zoomCenter` 不在 `panTo` 的官方声明里（Map.d.ts:591）
commands.panTo({ lng: 1, lat: 1 }, { zoomCenter: { lng: 1, lat: 1 } });

// @ts-expect-error `zoomCenter` 不在共享形状 `ViewCommandOptions` 上（只有 SetZoomOptions 有）
const _sharedZoomCenter: ViewCommandOptions = { zoomCenter: { lng: 1, lat: 1 } };
void _sharedZoomCenter;

/* ------------------------------------------------- 反例 3：不收官方声明之外的成员（假支持） */

// @ts-expect-error `enableAnimation` 属于 `ViewportOptions`（视野调整），不是逐调用视野命令的
const _wrongOptionSet: ViewCommandOptions = { enableAnimation: true };
void _wrongOptionSet;

// @ts-expect-error `zoomFactor` 同上，属于 `ViewportOptions`
const _zoomFactor: SetZoomOptions = { zoomFactor: 1.2 };
void _zoomFactor;

// @ts-expect-error `margins` 同上，属于 `ViewportOptions`
const _margins: PanToOptions = { margins: [10, 10, 10, 10] };
void _margins;

// @ts-expect-error 没有官方声明的 `cancelable`
commands.setHeading(45, { cancelable: true });

/* ------------------------------------- 反例 4：成员类型必须与官方一致（不接受 `any` 退化） */

// @ts-expect-error callback 的形状是零参 `() => void`，不是带参的函数
commands.setHeading(45, { callback: (value: number) => void {} });

// @ts-expect-error callback 必须真的是函数（`boolean` 不是可调用对象）
commands.setTilt(30, { callback: true });

// @ts-expect-error noAnimation 是 boolean，不是数字
commands.setZoom(3, { noAnimation: 1 });

// @ts-expect-error zoomCenter 是**领域** Point（`{ lng; lat }`），不是 string
commands.setZoom(3, { zoomCenter: "北京" });

// @ts-expect-error duration 是数字（毫秒），不是字符串
commands.panTo({ lng: 1, lat: 1 }, { duration: "300" });

// @ts-expect-error zoomCenter 的成员是数字，`lng` 不是 string
commands.setZoom(3, { zoomCenter: { lng: "1", lat: 2 } });
