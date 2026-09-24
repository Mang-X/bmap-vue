/**
 * OverlaySpec —— 覆盖物组件的**声明式**生命周期与字段更新策略（M5-SPEC-MARKER / issue #30，
 * M5-VECTORS / issue #31 扩展）
 *
 * 一个覆盖物组件到这里只剩两件事：**声明**（本文件）与**渲染**（SFC）。创建 / 挂载 /
 * 更新 / 重建 / 卸载、实例 child scope、Registry 记账、Target 提供、SDK 事件绑定全部由
 * `useOverlaySpec`（`core/composables/useOverlaySpec.ts`）按声明驱动。
 *
 * ## 为什么字段要**声明**策略，而不是让组件各写一套 watcher
 *
 * 迁移前每个覆盖物组件手写 3~11 个 `watch`，且「哪个属性是构造期属性」这个判断散落在组件里
 * （Marker 为了 icon 还去探测过 raw SDK 有没有 `setIcon`）。现在：
 *
 * - 组件声明**意图**（`fields`：这个 prop 是位置 / 就地更新 / 构造期 / 显隐 / 版本令牌 / 旧别名）；
 * - **分类的事实源仍是 Driver 的属性描述符**（`OVERLAY_DESCRIPTORS`，由官方类型包与 API 参考
 *   逐条核对得来），更新一律经 `driver.overlays.setOptions` 落地，由描述符决定就地更新还是
 *   告警/重建。组件**不**探测 raw SDK 成员形状（raw SDK 边界规则）。
 *
 * 两者由用例交叉锁定（`v3-overlay-spec.test.ts` / `v3-overlay-suite.test.ts`）：声明的键集必须
 * **恰好覆盖**组件的全部 props，且声明为 `options` 的字段在描述符里必须是 `mutable`、声明为
 * `recreate` 的必须是 `recreate`。
 *
 * ## issue #31 加了三件事（都由本文件表达）
 *
 * 1. **事件面由矩阵派生**：组件只声明 `kind`（`OverlayKind`），`useOverlaySpec` 从
 *    `core/overlays/overlayEventCatalog.ts` 取出该 kind 的全部事件并绑定；`events` 只用于
 *    **覆盖**需要自定义处置的条目（例如 Marker 的 `dragend` 要回写位置模型）。
 * 2. **watch 源可声明**：`watchSources` 让「大数组按根引用 + 版本 prop 触发」成为声明的一部分，
 *    而不是每个组件自己拼 `watch([() => p.path, () => p.pathVersion])`——那条路要么退化成
 *    `JSON.stringify` 深比较（大 path 每次渲染 O(n)），要么在组件间各写一遍且写法不一致。
 * 3. **两个组件侧策略**：`version`（版本令牌：只参与它配对字段的 watch，自己不出现任何命令）与
 *    `alias`（旧 prop 名：由集中弃用层在**读取层**解析成正典值，自己不出现任何命令）。
 *
 * ## 与官方参考实现 `huiyan-fe/react-bmap@2.0.2` 的对照
 *
 * | 维度 | 参考实现（`createOverlayComponent`） | 本库 |
 * | --- | --- | --- |
 * | 声明面 | `optionProps`（就地）/ `ctorOnlyProps`（重建）两个**手抄数组** | `fields` 一张表，**分类由 Driver 描述符给出**，并有交叉校验 |
 * | 键名映射 | 直接透传 prop 名给 SDK | `descriptorKeys` 显式声明映射（如语义键 `position` → `setPosition`） |
 * | 位置 | `positionProp` 单字段 + `setOverlayPosition` | `"position"` 策略：受控 prop ↔ SDK 双向同步 + 回环抑制 |
 * | 路径 / 大数组 | `pathProp` + `stableStringify` 进 effect deps | `watchSources` 的 `"versioned"`：根引用 + 版本 prop，不做深比较 |
 * | 显隐 | 单独 `useEffect`（`hideOverlay`/`showOverlay`） | `"visibility"` 策略，且**区分「在图上但隐藏」与「未挂载」** |
 * | 事件 | 每个组件手抄 `events: { sdk, prop }[]` | 事件面由 kind 的事件矩阵派生，`events` 只写覆盖项 |
 * | 资源归属 | React effect cleanup | `ResourceScope`（实例 child scope）+ `OverlayRegistry` 一等 registration |
 *
 * 参考实现是「该有的接口面」的证据，但**不是照抄对象**：它手抄的两张数组正是本库用描述符取代
 * 的东西；它的 `stableStringify` 依赖链也是本库用 `watchSources` 取代的东西。
 */
import type { OverlayKind } from "../../driver/types/overlays";
import type { TargetKind } from "../context/target";
import type { MapReadyContext } from "../context/types";

/**
 * 字段的更新策略。
 *
 * 前四个与 Driver 描述符的分类一一对应，后两个是**组件侧语义**（不进描述符）。
 *
 * | 取值 | 含义 | 预期与描述符的关系 |
 * | --- | --- | --- |
 * | `position` | 位置字段：经 `driver.overlays.setPosition` 写入（含双向同步与回环抑制） | 描述符里该键为 `mutable`，且 `value: "point"` |
 * | `options` | 就地更新：进更新队列 → `driver.overlays.setOptions` | 描述符里该键必须是 `mutable` |
 * | `recreate` | 构造期属性：变化即**重建实例**（旧实例连同 child scope 一起释放） | 描述符里该键必须是 `recreate` |
 * | `visibility` | 显隐：优先 `show`/`hide`（不破坏覆盖物归属），不可用时退回 `add`/`remove` | 描述符里**没有**该键 |
 * | `version` | **版本令牌**：只作为某个字段的 watch 源之一（`watchSources` 的 `versioned`），自身不产生任何命令 | 描述符里**没有**该键，且必须被某条 `versioned` 引用 |
 * | `alias` | **旧 prop 名**：由集中弃用层（`core/deprecations`）在读取层解析成正典 prop 的值 | 描述符里**没有**该键，且必须在别名表里登记 |
 */
export type OverlayFieldUpdate =
  | "position"
  | "options"
  | "recreate"
  | "visibility"
  | "version"
  | "alias";

/**
 * 「组件侧语义」的字段策略：它们**不进** Driver 属性描述符。
 *
 * 单独导出成一张表而不是在断言里 `||` 三次：新增一个组件侧策略时，
 * 「哪些策略可以 `descriptorKeys[prop] = null`」是一处判断。
 */
export const OVERLAY_COMPONENT_ONLY_UPDATES: readonly OverlayFieldUpdate[] = Object.freeze([
  "visibility",
  "version",
  "alias",
]);

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
 * 字段的 watch 源策略（缺省 = `"fingerprint"`）。
 *
 * - `"fingerprint"`：对**内容**取稳定序列化指纹（`core/utils/stableKey.ts`）后比较。标量、
 *   小对象（`offset` / `icon` / `style` / `bounds`）用它：父级每次渲染传内联字面量时引用都会变，
 *   按引用比较会让「内容没变」也重新下发一次命令。
 * - `"reference"`：只比**根引用**。给「内容不可序列化」的值用：`GroundOverlay` 的 `url` 允许
 *   惰性工厂（`() => HTMLCanvasElement`），而 `stableKeyOf` 把函数折叠成常量 `"fn"` ⇒
 *   指纹比较会让「换了一个工厂」被静默忽略。**按引用是这里唯一正确的判据**。
 * - `{ source: "versioned", versionProp }`：根引用 + 一个**版本 prop** 作为强制刷新开关。大数组
 *   （`path` / `controlPoints`）用它：内容指纹是 O(n) 的序列化，而路径动辄上万点，每次父级渲染
 *   都算一遍不可接受（沿用 v3 既有约定：`pathVersion` 这类 prop 就是给「原地改数组」准备的逃生口）。
 */
export type OverlayFieldWatch =
  | "fingerprint"
  | "reference"
  | { readonly source: "versioned"; readonly versionProp: string };

/**
 * 一条 SDK 事件的处置方式。
 *
 * - `emit`：纯转发（载荷原样交给组件 emit）；
 * - `handle`：组件自定义（如 `dragend` 需要「先转发再回写位置模型」）。
 *
 * 二者互斥：同一个事件既有 `emit` 又有 `handle` 会让「谁先谁后」成为隐式约定。
 *
 * **注意**：`spec.events` 里只写**覆盖项**。未被覆盖的事件由 kind 的事件矩阵
 * （`core/overlays/overlayEventCatalog.ts`）自动派生并绑定，因此「组件忘了绑 click」不可能发生。
 * 覆盖项的 `sdk` 必须能在矩阵里查到（拼错即构造期抛错）。
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

  /**
   * 覆盖物种类（`OverlayKind`）：事件矩阵与集中弃用表的查询键。
   *
   * **刻意可选**：`OverlayKind` 是 SDK 内建覆盖物的封闭联合，第三方自建的覆盖物（DOM 覆盖物、
   * 组合覆盖物）可能不落在其中——它们仍然可以用 `OverlaySpec` 声明生命周期（回到 #30 的形态：
   * 只有 `spec.events` 生效）。
   *
   * 但**没有任何「按名字猜」的回落**：`kind` 为空时事件面**不会**由矩阵派生，`events` 必须自己写全
   * （写不全的后果是「声明了 emit 却永不触发」）。因此内建覆盖物一律显式写 `kind`——
   * 这也让「这个组件的事件面从哪来」在组件侧可见（`type` 只是记账标签，不该顺带承担这件事）。
   */
  readonly kind?: OverlayKind;

  /** prop → 更新策略（必须覆盖全部 props，由 `OverlayFieldMap` 在类型层保证）。 */
  readonly fields: OverlayFieldMap<Props>;

  /**
   * prop → Driver 描述符里的键。
   * - 缺省：与 prop 同名；
   * - `null`：该字段**不经描述符**（只允许 `visibility` / `version` / `alias` 这类组件侧语义）；
   *
   * 显式写出来而不是按命名规律推断（`descriptorKeys: { position: "position" }`）——「键名恰好相同」
   * 与「键名就是它」是两件事，后者需要被评审看见。
   */
  readonly descriptorKeys?: Partial<Record<keyof Props & string, string | null>>;

  /**
   * prop → watch 源策略（缺省 `"fingerprint"`）。见 `OverlayFieldWatch`。
   *
   * 只有 `options` / `recreate` 字段需要它：`position` 与两个组件侧策略各有自己的通道。
   */
  readonly watchSources?: Partial<Record<keyof Props & string, OverlayFieldWatch>>;

  /**
   * prop → **下发前的值投影**（缺省原样）。用于组件侧允许的「惰性值」。
   *
   * 唯一的当前消费者是 `GroundOverlay.url`：它接受 `string | HTMLCanvasElement | (() => …)`，
   * 而上游 `GroundOverlayOptions.url` / `setImage(url)` 只接受真实来源——工厂函数必须在这里被
   * 求值，否则会把一个函数交给 SDK（本库不允许「收下但没人读」的假支持）。
   *
   * 投影发生在**统一的 props 视图**里，因此 `create`、watch 与更新队列看到的是同一份值。
   *
   * **投影可能被多次求值**（每次读取求一次，没有缓存）：`fieldValues` 只保证「哪些字段要投影」，
   * 不保证「一轮里只投影一次」。因此对**有副作用 / 每次都产生新实例**的投影（工厂函数），
   * 调用点必须**自己先取一次**再复用（`GroundOverlay.create` 就是 `const url = p.url` 那一行），
   * 否则校验用的对象与交给 SDK 的对象会是两个不同实例（PR #103 评审 2）。
   */
  readonly fieldValues?: Partial<Record<keyof Props & string, (value: unknown) => unknown>>;

  /**
   * 挂载完成后的**组件侧副作用**（实例已经走完 `add` 与登记，`context` / `resource` 都可用）。
   *
   * 唯一的当前消费者是 `GroundOverlay.autoCenter`（按显示区域居中地图，走 `map.setViewport`）。
   * 它在语义上属于「创建完成」而不是「字段更新」，因此只在这里调用一次——与迁移前
   * `addToMap` 里那段 `if (p.autoCenter) setViewport(...)` 的位置一致。
   */
  readonly afterMount?: (
    context: MapReadyContext,
    resource: Resource,
    props: Readonly<Props>,
  ) => void;

  /** 子组件看到的挂载目标种类（`targetContextKey` 的 `kind`）。 */
  readonly targetKind?: TargetKind;

  /** 创建 SDK 实例（**只读 props**；构造期属性一律取自这里）。 */
  create(context: MapReadyContext, props: Readonly<Props>): Resource | Promise<Resource>;

  /** SDK 事件的**覆盖项**（其余事件由 kind 的事件矩阵派生）。绑定进实例 scope。 */
  readonly events?: readonly OverlayEventSpec[];
}

/** 声明自检的输入：除了 spec 本身，还要能查到该 kind 的 prop 别名（集中弃用表）。 */
export interface OverlayFieldDeclarationChecks {
  /** 该 kind 已登记的 prop 别名（`core/deprecations` 的 `propAliasesOf`）。 */
  readonly propAliases?: readonly {
    readonly canonical: string;
    readonly deprecated: readonly string[];
  }[];
}

/**
 * 声明自检（纯函数，`useOverlaySpec` 与用例共用）。
 *
 * 拦的是「声明自相矛盾」这一类错误，它们的运行时表现是「改了 prop 没反应」，排查成本极高：
 *
 * - 组件侧语义的字段（`visibility` / `version` / `alias`）**必须**被标成 `descriptorKeys[prop] = null`；
 * - 其余字段**不得**被标成 `null`（不经描述符 ⇒ 永远不会被下发）；
 * - **多个** `position` / `visibility` 字段：这两种策略各有一套单例状态（位置模型、挂载记账），
 *   第二个字段会被静默忽略——与其忽略，不如起不来；
 * - `versioned` watch 引用的版本 prop 必须是 `version` 字段，且每个 `version` 字段都要**真的被引用**
 *   （没被引用的版本令牌是一个「看起来能刷新、其实什么都不做」的 prop）；
 * - `alias` 字段必须在集中弃用表里登记过（否则它就是「收下但没人读」的假支持）。
 *
 * 抛 `Error`（不是 `BMapError`）：这是**编码期**错误，不是运行时环境问题，不该被错误边界当成
 * 可恢复的失败吞掉。
 */
export function assertOverlayFieldDeclarations<Props extends object, Resource>(
  spec: OverlaySpec<Props, Resource>,
  checks: OverlayFieldDeclarationChecks = {},
): void {
  const entries = Object.entries(spec.fields) as Array<[string, OverlayFieldUpdate]>;
  const aliasEntries = checks.propAliases ?? [];

  for (const [prop, update] of entries) {
    const declared = spec.descriptorKeys?.[prop as keyof Props & string];
    const descriptorKey = declared === undefined ? prop : declared;
    const componentOnly = OVERLAY_COMPONENT_ONLY_UPDATES.includes(update);
    if (componentOnly && descriptorKey !== null) {
      throw new Error(
        `OverlaySpec(${spec.type}): 字段 "${prop}" 声明为 ${update}，必须同时写 ` +
          `descriptorKeys["${prop}"] = null（${update} 是组件侧语义，不是 SDK 属性）`,
      );
    }
    if (!componentOnly && descriptorKey === null) {
      throw new Error(
        `OverlaySpec(${spec.type}): 字段 "${prop}" 声明为 ${update}，却标记为不经描述符；` +
          `只有 ${OVERLAY_COMPONENT_ONLY_UPDATES.join(" / ")} 这类组件侧语义可以 descriptorKeys[prop] = null`,
      );
    }
    if (update === "alias" && !aliasEntries.some((alias) => alias.deprecated.includes(prop))) {
      throw new Error(
        `OverlaySpec(${spec.type}): 字段 "${prop}" 声明为 alias，但集中弃用表里没有登记它；` +
          "旧 prop 名必须进 core/deprecations 的别名表，否则它就是收下但没人读的假支持",
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

  const versionFields = entries.filter(([, update]) => update === "version").map(([prop]) => prop);
  const referenced = new Set<string>();
  // `Object.entries` 在泛型 `Partial<Record<keyof Props & string, …>>` 上会退化成 `{}`
  // （`keyof Props` 是泛型参数，TS 求不出有限的键集），因此这里先收成字符串字典再校验。
  const watchSources = (spec.watchSources ?? {}) as Record<string, OverlayFieldWatch | undefined>;
  for (const [prop, source] of Object.entries(watchSources)) {
    // 只有 `versioned` 需要版本令牌；`fingerprint` / `reference` 是单源策略
    if (!source || source === "fingerprint" || source === "reference") continue;
    if (!entries.some(([name]) => name === prop)) {
      throw new Error(
        `OverlaySpec(${spec.type}): watchSources 里的 "${prop}" 不是声明过的字段`,
      );
    }
    const versionProp = source.versionProp;
    const policy = spec.fields[versionProp as keyof Props & string];
    if (policy !== "version") {
      throw new Error(
        `OverlaySpec(${spec.type}): 字段 "${prop}" 的 versioned watch 引用了 "${versionProp}"，` +
          `但它的策略是 ${String(policy)} 而不是 version`,
      );
    }
    referenced.add(versionProp);
  }
  const orphanVersions = versionFields.filter((prop) => !referenced.has(prop));
  if (orphanVersions.length > 0) {
    throw new Error(
      `OverlaySpec(${spec.type}): 版本令牌 ${orphanVersions.join(", ")} 没有被任何 watchSources 引用；` +
        "它不是 SDK 属性、也不产生命令，没人引用就等于一个什么都不做的 prop",
    );
  }
}
