/**
 * 通用受控 / 非受控状态（M4-STATE / issue #27、#137）
 *
 * ## 归属边界：Vue 拥有 Vue 的状态，本文件拥有 SDK 的状态
 *
 * #137 的口径是「Vue owns Vue state; Core owns SDK state」。这个 helper 恰好骑在两者的**缝**上，
 * 所以先说清它到底拥有哪半：
 *
 * | 腿 | 谁拥有 | 这里的形态 |
 * | --- | --- | --- |
 * | 父组件 ↔ 组件（props / emits） | **Vue** | 调用方传 `value: () => props.center`——这是**对 props 的 getter**，不是另存一份；写入侧是 `emit('update:center', …)`。这正是 Vue `v-model` 的展开形态，全库统一（`Map` / `Marker` / `InfoWindow` 都是「普通 prop + `update:*` emit」），**没有**第二个父↔子状态机需要收口。 |
 * | 组件 ↔ SDK（读回 / 写回 / 归位） | **本文件** | `internal` 镜像是 SDK 侧事实源的本地投影，容差相等、`copy` 落库、`reset()` 归位都是 SDK 侧语义，Vue 不拥有、也无法替我们表达。 |
 *
 * **为什么不用 `defineModel` / `useModel`（#137 已做原型，不是「没试过」）**：Vue 3.5 的
 * `useModel` 自带「受控：prop 优先 / 非受控：本地为源」，但它**自己不保存最后一次外部值**——
 * 受控 prop 被摘掉时读到的是 `undefined`，而本文件冻结的契约是「内部状态接管，**保留最后一次
 * 外部值**」。要维持这条语义，**必须额外补一段 bridge state**（记住最后外部值）。它同样没有
 * `defaultValue` 只读一次、没有容差相等、没有 `copy`、没有首次快照。
 *
 * #137 复审要求先做**真实原型**再定论。原型**已提交进仓库**：
 * `mapModel.prototype.test.ts`（两种接线都手写 `defineProps`/`defineEmits`，不动 `MapProps`，
 * props 形状完全一致）。结论分三层，别混：
 *
 * - **语义缺口是真的，但可补**：补上一段「记住最后外部值」的 bridge state（原型里叫 `internal`
 *   镜像）后原型**能**逐项复现现状的可观察结果
 *   （容差抖动、真实变化、受控→非受控保留最后值、default 只读一次）。所以「做不到」是错的说法。
 *   但补的位置有**三处**，不止「记住最后外部值」：真实非受控用法下 `useModel` 读到的
 *   `localValue` 是 Vue 自己的局部状态（读与档位都判错），且 `reset()` 无法同步它 ⇒ setter 的
 *   全局去重会吞掉 reset 后的下一次真实交互。**没有公开 API 能补**。
 * - **代价上（实测，唯一口径）**：按「每个 number 字段实际注册的 `ReactiveEffect` 数」
 *   （`getCurrentScope().effects.length`，由 Vue 自己记账）—— 现状 **2**，`useModel` + 桥接
 *   是 **3**（含 `default*` 告警 watcher）。Vue-native **没有更省**。
 * - **最强的反面读数**：三处补完之后，**把剩下的 `useModel` 写通道也换成直接 `emit`、再删掉它
 *   的声明，11 条行为用例仍然全过**（只有 2 条 effect 计数变红）——它在这条线路上换不到任何可观察
 *   行为，不再是承重构件。
 * - **措辞纪律**：这**只能**说「没减少 effect」，**不能**说「runtime 更贵」——effect 数与结构数
 *   都推不出成本大小，那需要 profile。
 *
 * `defineModel` 另有一层：它自己生成 prop/emit，会改到被 fixture 断言的冻结 `MapProps`；而
 * `useModel` 不需要（它接受现成 `props`）。**但这不是否决 `useModel` 的理由** —— 真正的理由
 * 是上面那句「没有更省」。⇒ 保留本 helper 作为通用原语，`<Map>` 的接线不动。详见 ADR
 * `2026-09-14-map-controlled-state` §6.1 与 §6.2 的原型读数。
 *
 * ## 三种来源
 *
 * 一个字段有**三种来源**，优先级固定为：受控值 > 非受控初值 > 库默认值。
 *
 * | 模式 | 判定 | 生效值 | 外部值变化 | 内部状态变化（用户交互 / SDK 回写） |
 * | --- | --- | --- | --- | --- |
 * | 受控 | 受控 getter 返回非 `undefined` | 外部值 | 写进内部镜像（受控值优先） | 更新内部镜像并通知调用方 |
 * | 非受控 | 受控 getter 返回 `undefined`，`defaultValue` 有值 | 内部状态 | 不适用 | 更新内部状态 |
 * | 缺省 | 两者都没有 | 内部状态（初值 = `fallback`） | 不适用 | 更新内部状态 |
 *
 * 五条**无歧义规则**（受控语义一旦发布很难改，因此这里冻结，详见 ADR
 * `2026-09-14-map-controlled-state`）：
 *
 * 1. **`defaultValue` 只在首次解析时读一次**。之后它的变化不会覆盖内部状态——否则
 *    「用户拖到 A，父级重算 default 得到 B」会把用户操作静默吃掉。失效时输出一次 dev 告警。
 * 2. **模式按「当前受控值是否存在」实时判定，不冻结在首次解析**。父级异步加载后才传入受控值
 *    是常见用法（`<Map :center="loaded ? spot : undefined">`），冻结会让那次更新丢失。
 * 3. **模式切换只告警、不拒绝**，且只在「切换会造成事实源歧义」时告警：
 *    - 非受控 → 受控：仅当外部值与当前内部状态**冲突**（超出容差）时才告警。
 *      `v-model` 的正常首帧回写（父级写回的值 == 刚交互得到的值）不告警，否则每个用户
 *      第一次拖动地图都会看到一条无意义的告警。
 *    - 受控 → 非受控：内部状态接管（保留最后一次外部值），告警一次。
 * 4. **可变值必须经 `copy` 落库**：初值、外部同步、SDK 回写三处都不与调用方的对象共享引用，
 *    否则调用方一次原地修改就绕过了整个状态机。
 * 5. **「回到初值」的命令必须同时重置状态**（`reset()`）：只在外部世界（地图）侧重置会让非受控档的
 *    状态与地图分叉，且随后的**真实**变化会被 `commit` 判成「没变化」而丢掉（第三轮评审 P1）。
 *
 * 每个字段每种方向最多告警一次（`warned` 集合），避免高频 prop 变化刷屏。
 *
 * **不做什么**：不实现「受控值不变时把 SDK 强行回退到外部值」。参考实现
 * `huiyan-fe/react-bmap` 同样不做：回退需要在中途事件（`moving` / `zooming`）上持续写回，
 * 会与用户手势打架，且在中止（松手回弹）时产生抖动。代价是「父级忽略 `update:*` 时地图停在
 * 用户操作后的位置」，这条已写进 `docs/zh-CN/components/map.md` 的状态表。
 *
 * 调用位置要求与库内其它 composable 一致：必须在 `setup()` 或 `effectScope()` 内调用
 * （内部会注册一个 `defaultValue` 变化的告警 watcher，需要随作用域一起释放）。
 */
import { computed, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import { devWarn } from "../core/logger";

/** 相等判定。**必须容忍浮点抖动**（见 `core/utils/equality`），否则受控写入与 SDK 回写会形成往返。 */
export type EqualFn<T> = (a: T, b: T) => boolean;

/** 当前模式：`controlled` 由外部值决定，`uncontrolled` 由内部状态决定。 */
export type ControllableMode = "controlled" | "uncontrolled";

export interface UseControllableStateOptions<T> {
  /** 字段名（告警文案与 context）。 */
  name: string;
  /** 受控值读取器：返回 `undefined` 表示当前处于非受控。 */
  value: () => T | undefined;
  /** 非受控初值读取器：**只在首次解析时读一次**，后续变化不生效（会告警一次）。 */
  defaultValue?: () => T | undefined;
  /** 既无受控值也无非受控初值时的库默认值（只在首次解析时使用）。 */
  fallback: T;
  /** 相等判定。 */
  equals: EqualFn<T>;
  /**
   * 值的防御性拷贝（默认恒等）。
   *
   * 传**可变对象**（如坐标点）时应当提供：初值与每次外部同步都会经过它，否则内部状态会与
   * 调用方的对象共享引用——调用方原地修改就绕过了状态机（不产生 `commit`，也会把「首次快照」
   * 一起改掉）。不可变值（字符串 / 数字）不需要。
   */
  copy?: (value: T) => T;
  /**
   * 是否输出用法告警（默认 true）。
   *
   * 即使为 true，也只有**非生产环境**才真正打印：`devWarn` 读 `process.env.NODE_ENV`，
   * 判定留给**消费方**——ESM 产物保留该标记由消费方打包器 / 运行时折叠（Vite、webpack 都能折），
   * IIFE 档在构建期就折成 `production`（见 ADR 决策 4 与已知限制 8）。
   */
  warn?: boolean;
}

export interface ControllableState<T> {
  /** 生效值：受控时读外部值，非受控时读内部状态。 */
  readonly value: ComputedRef<T>;
  /** 内部状态（非受控模式的事实源；受控模式是外部值的镜像）。 */
  readonly internal: ShallowRef<T>;
  /**
   * 当前是否受控（外部值存在）。
   *
   * ⚠️ **库内没有消费者**（#137 审计结论）：`<Map>` 判断档位用的是 `value() !== undefined` 的
   * 即时读取，不是这个 computed。它留在返回类型上是因为 `useControllableState` 是**已发布的
   * 公共 composable**（ADR `2026-09-14-map-controlled-state` 决策 6），返回值形状属于冻结契约 ——
   * 删掉它是破坏性变更，不在 #137「不改动已冻结公共语义」的范围内。
   *
   * 所以：**别再去找它的库内调用点**。若将来确实要移除，走单独的破坏性变更票，并同步
   * `docs/zh-CN/hooks/useControllableState.md`。
   *
   * **它被惰性创建**（#137 复审八轮 P1）：早先把「公共 API 保留该成员」当成「`<Map>` 必须为它
   * 实例化这份 runtime」，是**两件被混成一件的事**。既然库内零消费者，就不必在每次
   * `useControllableState()` 调用时都分配它——`get` 取用时才建，类型与消费方式都未变。
   */
  readonly isControlled: ComputedRef<boolean>;
  /** 首次解析出的初值（初次视野 / 初始渲染用）。 */
  readonly initial: T;
  /**
   * 外部值变化入口（调用方在自己的 watcher 里调用）。
   *
   * 传入 `undefined` 表示当前没有受控值。
   */
  syncExternal(next: T | undefined): void;
  /**
   * 内部状态变化入口（用户交互 / SDK 事件回写）。
   *
   * @returns 是否真的发生了变化（相等判定含容差）。调用方应只在返回 `true` 时向上通知，
   * 这就是「相同值不同引用不重复更新」与「父级回写相同值不再写 SDK」的实现依据。
   */
  commit(next: T): boolean;
  /**
   * 把内部状态恢复为**首次解析的初值**（不通知调用方）。
   *
   * 调用方执行「回到初值」这类命令（如 `resetView()`）之后用它让状态跟上，
   * 否则非受控档会出现「状态与外部世界不一致，且后续真实变化被判成没变化」。
   */
  reset(): void;
}

export function useControllableState<T>(
  options: UseControllableStateOptions<T>,
): ControllableState<T> {
  const {
    name,
    value,
    defaultValue,
    fallback,
    equals,
    copy = (input: T) => input,
    warn = true,
  } = options;

  // 首次解析固化三个来源的优先级：受控值 > 非受控初值 > 库默认值。
  // 经 `copy` 落库：调用方后续原地修改自己的对象不会改到这里的初值。
  const initial = copy(value() ?? defaultValue?.() ?? fallback);
  // 内部状态**再拷一份**：`initial` 会被调用方长期持有（例如组件的「首次视野快照」），
  // 两者共享同一对象会让其中一方的原地修改影响另一方。
  const internal = shallowRef(copy(initial)) as ShallowRef<T>;
  const model = computed<T>(() => value() ?? internal.value);
  // `isControlled` **惰性创建**（#137 复审八轮 P1）：它挂在**已发布的公共返回形状**上不能删，
  // 但**库内零消费者** —— `<Map>` 判断档位用的是即时的 `value() !== undefined`，从不读这个成员。
  // 「公共 API 必须保留该成员」与「`<Map>` 必须为它实例化 runtime」是**两件事**（复审指出早先
  // 把它们当成一件，见 §6.2）。这里用 getter + 缓存：返回类型 `ComputedRef<boolean>` 一字未改，
  // 公共消费者照旧 `state.isControlled.value`；没人访问就**不分配**那个 computed。
  //
  // 惰性创建时若已脱离 `setup()` 的 effect scope，那个 computed 不会随作用域释放 —— 但它只由
  // 公共消费者触发，而它们都在 `setup()` / `effectScope()` 内调用（见本文件底部的调用位置要求），
  // 与原先的构造时机等价。
  let isControlledRef: ComputedRef<boolean> | undefined;

  let mode: ControllableMode = value() === undefined ? "uncontrolled" : "controlled";
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string): void => {
    if (!warn || warned.has(key)) return;
    warned.add(key);
    devWarn(message, { field: name });
  };

  function syncExternal(next: T | undefined): void {
    if (next === undefined) {
      if (mode === "controlled") {
        warnOnce(
          "to-uncontrolled",
          `${name} 由受控切换为非受控：内部状态接管，并保留最后一次外部值。受控与非受控请在组件生命周期内保持一致。`,
        );
      }
      mode = "uncontrolled";
      return;
    }
    if (mode === "uncontrolled" && !equals(next, internal.value)) {
      warnOnce(
        "to-controlled",
        `${name} 由非受控切换为受控：当前内部状态与外部值不一致，之后以外部值（及其变化）为准。受控与非受控请在组件生命周期内保持一致。`,
      );
    }
    internal.value = copy(next);
    mode = "controlled";
  }

  function commit(next: T): boolean {
    if (equals(next, internal.value)) return false;
    internal.value = copy(next);
    return true;
  }

  /**
   * 把内部状态恢复为**首次解析的初值**（`initial`）。
   *
   * 用途：调用方执行了「回到初值」这类命令之后（如 `<Map>` 的 `resetView()`），让状态与外部世界
   * 保持一致。**刻意不通知**（不 emit）：那是命令方决定的，不是用户交互或 SDK 回写。
   *
   * 为什么必须有它：非受控档下内部状态就是事实源。若只在 SDK 侧重置而不动状态，
   * 「重置 → 用户再次拖到重置前的那个值」会因为 `commit` 判等为「没变化」而**不 emit**，
   * 真实操作被吃掉（#27 评审第三轮 P1）。
   */
  function reset(): void {
    internal.value = copy(initial);
  }

  if (defaultValue) {
    watch(defaultValue, (next, previous) => {
      // 首次解析之后**任何** default 写入都不生效，都该告警一次：值改变、从无到有、从有到无。
      // 「两边都没给」与「值没变」不算写入——父级每次渲染传内联字面量时引用会变，但语义没变。
      if (next === undefined && previous === undefined) return;
      if (next !== undefined && previous !== undefined && equals(next, previous)) return;
      warnOnce(
        "default-ignored",
        `${name} 的 default 值只在首次解析时生效，之后的变化不会覆盖当前状态；若需要持续受控，请改用受控值（组件上即 v-model:${name}）。`,
      );
    });
  }

  return {
    value: model,
    internal,
    get isControlled(): ComputedRef<boolean> {
      // 首次访问才建；之后同一个实例（`computed` 自带缓存，重建会丢缓存）。
      isControlledRef ??= computed(() => value() !== undefined);
      return isControlledRef;
    },
    initial,
    syncExternal,
    commit,
    reset,
  };
}
