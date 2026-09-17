/**
 * OverlaySpec —— 覆盖物组件的**声明式**生命周期与字段更新策略（M5-SPEC-MARKER / issue #30）
 *
 * 一个覆盖物组件到这里只剩两件事：**声明**（本文件）与**渲染**（SFC）。创建 / 挂载 /
 * 更新 / 重建 / 卸载、实例 child scope、Registry 记账、Target 提供、SDK 事件绑定全部由
 * `useOverlaySpec`（`core/composables/useOverlaySpec.ts`）按声明驱动。
 *
 * ## 为什么字段要**声明**策略，而不是让组件各写一套 watcher
 *
 * 迁移前每个覆盖物组件手写 3~11 个 `watch`，且「哪个属性是构造期属性」这个判断散落在组件里
 * （BMarker 为了 icon 还去探测过 raw SDK 有没有 `setIcon`）。现在：
 *
 * - 组件声明**意图**（`fields`：这个 prop 是位置 / 就地更新 / 构造期 / 显隐）；
 * - **分类的事实源仍是 Driver 的属性描述符**（`OVERLAY_DESCRIPTORS`，由官方类型包与 API 参考
 *   逐条核对得来），更新一律经 `driver.overlays.setOptions` 落地，由描述符决定就地更新还是
 *   告警/重建。组件**不**探测 raw SDK 成员形状（raw SDK 边界规则）。
 *
 * 两者由用例交叉锁定（`v3-overlay-spec.test.ts`）：声明的键集必须**恰好覆盖**组件的全部 props，
 * 且声明为 `options` 的字段在描述符里必须是 `mutable`、声明为 `recreate` 的必须是 `recreate`。
 * 于是「Marker 所有公开属性都有明确更新策略」不是文档承诺，而是一条会红的检查。
 *
 * ## 与官方参考实现 `huiyan-fe/react-bmap` 的对照
 *
 * | 维度 | 参考实现（`createOverlayComponent`） | 本库 |
 * | --- | --- | --- |
 * | 声明面 | `optionProps`（就地）/ `ctorOnlyProps`（重建）两个**手抄数组** | `fields` 一张表，**分类由 Driver 描述符给出**，并有交叉校验 |
 * | 键名映射 | 直接透传 prop 名给 SDK | `descriptorKeys` 显式声明映射（如语义键 `position` → `setPosition`） |
 * | 位置 | `positionProp` 单字段 + `setOverlayPosition` | `"position"` 策略：受控 prop ↔ SDK 双向同步 + 回环抑制 |
 * | 显隐 | 单独 `useEffect`（`hideOverlay`/`showOverlay`） | `"visibility"` 策略，且**区分「在图上但隐藏」与「未挂载」** |
 * | 事件 | `events: { sdk, prop }[]` | `events: { sdk, emit \| handle }[]`，绑定进实例 scope |
 * | 资源归属 | React effect cleanup | `ResourceScope`（实例 child scope）+ `OverlayRegistry` 一等 registration |
 *
 * 参考实现是「该有的接口面」的证据，但**不是照抄对象**：它手抄的两张数组正是本库用描述符取代的东西。
 */
import type { TargetKind } from "../context/target";
import type { MapReadyContext } from "../context/types";

/**
 * 字段的更新策略。前三个与 Driver 描述符的分类一一对应，第四个是覆盖物组件共有的显隐语义。
 *
 * | 取值 | 含义 | 预期与描述符的关系 |
 * | --- | --- | --- |
 * | `position` | 位置字段：经 `driver.overlays.setPosition` 写入（含双向同步与回环抑制） | 描述符里该键为 `mutable`，且 `value: "point"` |
 * | `options` | 就地更新：进更新队列 → `driver.overlays.setOptions` | 描述符里该键必须是 `mutable` |
 * | `recreate` | 构造期属性：变化即**重建实例**（旧实例连同 child scope 一起释放） | 描述符里该键必须是 `recreate` |
 * | `visibility` | 显隐：优先 `show`/`hide`（不破坏覆盖物归属），不可用时退回 `add`/`remove` | 描述符里**没有**该键（它不是 SDK 属性） |
 */
export type OverlayFieldUpdate = "position" | "options" | "recreate" | "visibility";

/**
 * prop → 更新策略的**完整**映射。
 *
 * `-?` 是刻意的：可选 prop 也必须有策略，否则「没给标志的字段」会静默落进默认分支。
 * 键集由类型层强制覆盖，漏一个就编译失败。
 */
export type OverlayFieldMap<Props> = {
  readonly [K in keyof Props]-?: OverlayFieldUpdate;
};

/**
 * 一条 SDK 事件的处置方式。
 *
 * - `emit`：纯转发（载荷原样交给组件 emit）；
 * - `handle`：组件自定义（如 `dragend` 需要「先转发再回写位置模型」）。
 *
 * 二者互斥：同一个事件既有 `emit` 又有 `handle` 会让「谁先谁后」成为隐式约定。
 */
export type OverlayEventSpec =
  | { readonly sdk: string; readonly emit: string }
  | { readonly sdk: string; readonly handle: (event: unknown) => void };

export interface OverlaySpec<Props extends object, Resource> {
  /**
   * Registry 记账用的类型名（`OverlayRegistry.registerResource({ type })`）。
   *
   * 与 Driver 的描述符 `kind` 分开：前者是「挂在这张地图上的什么」，后者是「哪个 SDK 构造器」。
   * 二者当前同名（`"marker"`），但把它们合成一个会让「Registry 只关心类型标签」这条约束消失。
   */
  readonly type: string;

  /** prop → 更新策略（必须覆盖全部 props，由 `OverlayFieldMap` 在类型层保证）。 */
  readonly fields: OverlayFieldMap<Props>;

  /**
   * prop → Driver 描述符里的键。
   * - 缺省：与 prop 同名；
   * - `null`：该字段**不经描述符**（只允许 `visibility` 这类组件侧语义）；
   *
   * 显式写出来而不是按命名规律推断（`descriptorKeys: { position: "position" }`）——「键名恰好相同」
   * 与「键名就是它」是两件事，后者需要被评审看见。
   */
  readonly descriptorKeys?: Partial<Record<keyof Props & string, string | null>>;

  /** 子组件看到的挂载目标种类（`targetContextKey` 的 `kind`）。 */
  readonly targetKind?: TargetKind;

  /** 创建 SDK 实例（**只读 props**；构造期属性一律取自这里）。 */
  create(context: MapReadyContext, props: Readonly<Props>): Resource | Promise<Resource>;

  /** SDK 事件 → 组件 emit / 自定义处置。绑定进实例 scope。 */
  readonly events?: readonly OverlayEventSpec[];
}

/**
 * 声明自检（纯函数，`useOverlaySpec` 与用例共用）。
 *
 * 拦的是「声明自相矛盾」这一类错误，它们的运行时表现是「改了 prop 没反应」，排查成本极高：
 *
 * - 非 `visibility` 的字段被标成 `descriptorKeys[prop] = null`（不经描述符 ⇒ 永远不会被下发）；
 * - `visibility` 字段**没有**被标成 `null`（显隐不是 SDK 属性，写进描述符键只会让它落进
 *   `setOptions` 的未知键分支）；
 * - **多个** `position` / `visibility` 字段：这两种策略各有一套单例状态（位置模型、挂载记账），
 *   第二个字段会被静默忽略——与其忽略，不如起不来。
 *
 * 抛 `Error`（不是 `BMapError`）：这是**编码期**错误，不是运行时环境问题，不该被错误边界当成
 * 可恢复的失败吞掉。
 */
export function assertOverlayFieldDeclarations<Props extends object, Resource>(
  spec: OverlaySpec<Props, Resource>,
): void {
  const entries = Object.entries(spec.fields) as Array<[string, OverlayFieldUpdate]>;
  for (const [prop, update] of entries) {
    const declared = spec.descriptorKeys?.[prop as keyof Props & string];
    const descriptorKey = declared === undefined ? prop : declared;
    if (descriptorKey === null && update !== "visibility") {
      throw new Error(
        `OverlaySpec(${spec.type}): 字段 "${prop}" 声明为 ${update}，却标记为不经描述符；` +
          "只有 visibility 这类组件侧语义可以 descriptorKeys[prop] = null",
      );
    }
    if (update === "visibility" && descriptorKey !== null) {
      throw new Error(
        `OverlaySpec(${spec.type}): 字段 "${prop}" 声明为 visibility，必须同时写 ` +
          `descriptorKeys["${prop}"] = null（显隐不是 SDK 属性，不进属性描述符）`,
      );
    }
  }
  for (const strategy of ["position", "visibility"] as const) {
    const declared = entries.filter(([, update]) => update === strategy).map(([prop]) => prop);
    if (declared.length > 1) {
      throw new Error(
        `OverlaySpec(${spec.type}): 声明了多个 ${strategy} 字段（${declared.join(", ")}）；` +
          `该策略只有一套单例状态，一次只能有一个字段使用它`,
      );
    }
  }
}
