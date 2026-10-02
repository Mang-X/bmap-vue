/**
 * 控件的**命令面**（issue #168 item 1）
 *
 * ## 为什么单独一个文件
 *
 * 的判据与  对覆盖物同一条：「官方有的公开方法**有没有调用路径**」。
 * `grep defineExpose` 在 `components/controls/**` 上 0 命中 ⇒ `GeolocationControl#location()` /
 * `CityListControl#toggle()` / `getCityName()` 这一族**在本库没有任何入口**。
 * 「改 prop」不算：那是**受控写入**，与「持有 ref 调一个官方同名的方法」是两条路径——
 * `toggle()` 是动作（没有对应的 prop），`getCityName()` 是读回（组件永远不会替你读一次）。
 *
 * ## 三条口径（与 `core/overlays/overlayCommands.ts` 逐条一致）
 *
 * 1. **本文件是框架无关的**（不 import vue），入参只有「一次可用的会话」+ 组件名，
 *    因此可以在没有 Vue 的单测里直接驱动。
 * 2. **释放后必须显式失败，绝不静默 no-op**。会话取不到时抛 `BMAP_RESOURCE_DISPOSED`——
 *    静默返回 `undefined` 会让调用方把「资源已释放」误判成「SDK 说没有」。判定是
 *    **每次命令现取会话**，因此控件重建（改 `recreate` 类 option）后旧闭包不会打进已死的实例。
 * 3. **不碰 raw SDK**。所有调用都经 `ControlDriver` 的归一化命令面
 *    （`driver/types/controls.ts` 的 `LocationCommandApi` / `CityListCommandApi`），
 *    本文件因此**不出现**任何 `handle.raw`——`core/` 不在 AGENTS.md 的 raw SDK 白名单内。
 *
 * ## 为什么 `getTriggerDom` 不在这里
 *
 * 官方声明了 `CityListControl#getTriggerDom(): HTMLElement | undefined`，但返回值是**原生
 * DOM 元素**，收窄成领域投影**不成立**（一个 `HTMLElement` 没有可投影的领域值，它全部的
 * 意义就是那个节点本身）。交出去会把 SDK 内部渲染结构变成公共契约。取舍与依据逐条写在
 * `driver/types/controls.ts` 的 `CityListCommandApi` 上，并由
 * `tests/behavior/control-commands.test.ts` 的「刻意不暴露」一组钉成会红的一条。
 */
import { BMapError } from "../errors/BMapError";
import type { ControlDriver } from "../../driver/types/controls";
import type { ControlHandle } from "../../driver/types/handles";
import type {
  CityListCommandApi,
  LocationAddressComponents,
  LocationCommandApi,
} from "../../driver/types/controls";

/**
 * 一次可用的控件会话：**两个引用必须来自同一时刻**（重建期间取到的 driver 与 handle
 * 可能分属两代），因此它们被绑在一个对象里由调用方一起求值。
 */
export interface ControlCommandSession {
  readonly driver: ControlDriver;
  readonly handle: ControlHandle;
}

/** 命令面的创建输入（与 `OverlayCommandContext` 同一形状）。 */
export interface ControlCommandContext {
  /**
   * **当前会话**的取值器；未就绪、重建窗口内或已释放时返回 `null`。
   *
   * 每条命令都重新求值：控件会因构造期 option 变化而换实例，闭包里存死句柄会让命令
   * 打到一个已经不在地图上的控件上。
   */
  session(): ControlCommandSession | null;
  /** 组件名（诊断用）。 */
  readonly component: string;
}

function disposed(component: string, command: string): BMapError {
  return new BMapError(
    "BMAP_RESOURCE_DISPOSED",
    `${component}.${command}(): 控件未就绪、正在重建或已经释放，本次调用被拒绝` +
      "（不静默 no-op——读回会拿到 undefined、动作会悄无声息地丢掉）。" +
      "请在资源就绪后调用（先看组件 ref 上的 status）。",
    { component },
  );
}

/** 取会话；取不到即**显式失败**。命令面里没有「静默返回」这一档（见文件头第 2 条）。 */
function require<C extends ControlCommandContext>(
  input: C,
  command: string,
): ControlCommandSession {
  const session = input.session();
  if (!session) throw disposed(input.component, command);
  return session;
}

/* ------------------------------------------------------------------------ Location */

/**
 * 定位控件的命令面（官方 `control/GeolocationControl.d.ts` 的四个成员）。
 *
 * 逐条对应关系（`startLocation` 而**不是** `startLocationTrace` 的依据见
 * `driver/types/controls.ts` 的 `LocationCommandApi`，含 live AK 读数）。
 */
export function createLocationCommands(input: ControlCommandContext): LocationCommandApi {
  const commands = (): LocationCommandApi =>
    require(input, "locationCommands").driver.locationCommands(
      require(input, "locationCommands").handle,
    );
  return {
    location: () => commands().location(),
    startLocation: () => commands().startLocation(),
    stopLocationTrace: () => commands().stopLocationTrace(),
    getAddressComponent: (): LocationAddressComponents | null => commands().getAddressComponent(),
  };
}

/* ----------------------------------------------------------------------- CityList */

/** 城市列表控件的命令面（官方 `control/CityListControl.d.ts` 的两个成员）。 */
export function createCityListCommands(input: ControlCommandContext): CityListCommandApi {
  const commands = (): CityListCommandApi =>
    require(input, "cityListCommands").driver.cityListCommands(
      require(input, "cityListCommands").handle,
    );
  return {
    toggle: () => commands().toggle(),
    getCityName: () => commands().getCityName(),
  };
}

/* ------------------------------------------------------------------ 公开类型出口 */

/**
 * 全部控件命令面的**按组件**索引（issue #168 item 1）。
 *
 * 与 `OverlayCommandTypes` 同一手法：消费方在父组件里标注一个 handler 时需要知道
 * 「`<LocationControl>` 的 ref 上有哪些方法」，逐个去翻 `spec.ts` 不可行。
 *
 * 键是**组件名**（不是 `ControlKind`）——调用方看到的是 `<LocationControl ref>`。
 * 没有命令面的组件**不出现在这张表里**：那正好表达「拿 ref 也没有命令」，
 * 而不是给一个空对象。
 */
export interface ControlCommandTypes {
  LocationControl: LocationCommandApi;
  CityListControl: CityListCommandApi;
}
