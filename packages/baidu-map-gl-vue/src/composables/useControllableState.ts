/**
 * 通用受控 / 非受控状态（M4-STATE / issue #27）
 *
 * 一个字段有**三种来源**，优先级固定为：受控值 > 非受控初值 > 库默认值。
 *
 * | 模式 | 判定 | 生效值 | 外部值变化 | 内部状态变化（用户交互 / SDK 回写） |
 * | --- | --- | --- | --- | --- |
 * | 受控 | 受控 getter 返回非 `undefined` | 外部值 | 写进内部镜像（受控值优先） | 更新内部镜像并通知调用方 |
 * | 非受控 | 受控 getter 返回 `undefined`，`defaultValue` 有值 | 内部状态 | 不适用 | 更新内部状态 |
 * | 缺省 | 两者都没有 | 内部状态（初值 = `fallback`） | 不适用 | 更新内部状态 |
 *
 * 三条**无歧义规则**（受控语义一旦发布很难改，因此这里冻结，详见 ADR
 * `2026-09-14-map-controlled-state`）：
 *
 * 1. **`defaultValue` 只在首次解析时读一次**。之后它的变化不会覆盖内部状态——否则
 *    「用户拖到 A，父级重算 default 得到 B」会把用户操作静默吃掉。失效时输出一次 dev 告警。
 * 2. **模式按「当前受控值是否存在」实时判定，不冻结在首次解析**。父级异步加载后才传入受控值
 *    是常见用法（`<BMap :center="loaded ? spot : undefined">`），冻结会让那次更新丢失。
 * 3. **模式切换只告警、不拒绝**，且只在「切换会造成事实源歧义」时告警：
 *    - 非受控 → 受控：仅当外部值与当前内部状态**冲突**（超出容差）时才告警。
 *      `v-model` 的正常首帧回写（父级写回的值 == 刚交互得到的值）不告警，否则每个用户
 *      第一次拖动地图都会看到一条无意义的告警。
 *    - 受控 → 非受控：内部状态接管（保留最后一次外部值），告警一次。
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
import { logger } from "../core/logger";

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
  /** 是否输出 dev 告警（默认 true；测试与需要绝对静默的调用方可关掉）。 */
  warn?: boolean;
}

export interface ControllableState<T> {
  /** 生效值：受控时读外部值，非受控时读内部状态。 */
  readonly value: ComputedRef<T>;
  /** 内部状态（非受控模式的事实源；受控模式是外部值的镜像）。 */
  readonly internal: ShallowRef<T>;
  /** 当前是否受控（外部值存在）。 */
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
}

export function useControllableState<T>(
  options: UseControllableStateOptions<T>,
): ControllableState<T> {
  const { name, value, defaultValue, fallback, equals, warn = true } = options;

  // 首次解析固化三个来源的优先级：受控值 > 非受控初值 > 库默认值。
  const initial = value() ?? defaultValue?.() ?? fallback;
  // shallowRef：内部状态由调用方整体替换（不做深转换）。深响应式会把调用方传入的普通对象
  // 变成 reactive 代理，再交给 SDK 时形状与 `Object.is` 语义都会变。
  const internal = shallowRef(initial) as ShallowRef<T>;
  const isControlled = computed(() => value() !== undefined);
  const model = computed<T>(() => value() ?? internal.value);

  let mode: ControllableMode = value() === undefined ? "uncontrolled" : "controlled";
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string): void => {
    if (!warn || warned.has(key)) return;
    warned.add(key);
    logger.warn(message, { field: name });
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
    internal.value = next;
    mode = "controlled";
  }

  function commit(next: T): boolean {
    if (equals(next, internal.value)) return false;
    internal.value = next;
    return true;
  }

  if (defaultValue) {
    watch(defaultValue, (next, previous) => {
      // 只对「值真的变了」告警：父级每次渲染都传内联字面量时，引用变化不代表语义变化。
      if (next === undefined || previous === undefined) return;
      if (equals(next, previous)) return;
      warnOnce(
        "default-ignored",
        `${name} 的 default 值只在首次解析时生效，之后的变化不会覆盖当前状态；若需要持续受控，请改用受控值（组件上即 v-model:${name}）。`,
      );
    });
  }

  return { value: model, internal, isControlled, initial, syncExternal, commit };
}
