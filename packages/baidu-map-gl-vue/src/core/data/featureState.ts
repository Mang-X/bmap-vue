/**
 * Feature State —— 批量数据图层的**要素状态命令面**（M6 / issue #36）
 *
 * 官方四类专页图层（`PointShapeLayer` / `PointIconLayer` / `LineLayer` / `FillLayer`）都提供
 * 同一组公开入口，本模块把这五个命令收成一处实现，让「状态按什么定位要素」只有一个口径：
 *
 * | 命令 | 官方入口 | 语义 |
 * | --- | --- | --- |
 * | `update(keys, state, { append })` | `updateState(keys, params, ifAppend)` | `append=false` **替换**这些 id 的整个状态对象；`true` 合并 |
 * | `remove(keys)` | `removeState(keys)` | 只摘掉列出的 id |
 * | `clear()` | `clearState()` | 清空全部 |
 * | `replace(inputs)` | `replaceAllState(inputs)` | **全量替换**（未覆盖到的 id 会消失） |
 * | `get(keys?)` | `getAllState()` | 读回；给了 keys 就只返回这些 id |
 *
 * ## 身份口径：只有业务 id，没有别的
 *
 * `keys` 是**业务 id**——也就是构造期 `idKey` 指定字段的值。这不是本库的约定，而是官方声明的
 * 原文（`updateState(keys: string | number | Array<string | number>, …)` 上写着「对应 idKey
 * 字段的值」）。因此本模块**不做**任何身份推断：
 *
 * - 不用 `dataIndex`（那是「本次 setData 里的下标」，数据一换就失效）；
 * - 不按调用顺序 / 事件顺序配对；
 * - 不缓存「我们认为 SDK 现在是什么状态」——`get` 一律**读回** SDK 的当前值（`getAllState()`），
 *   因为 `setData` 触发的数据重新解析、以及 SDK 自己的默认值都会让本地账本与 SDK 分叉。
 *
 * 身份**没声明**（组件没给 `idKey`）时五个命令一律**拒绝执行**并告警一次（见 `identity` 的契约）：
 * 让它们过去就等价于悄悄依赖 SDK 的默认 `idKey`，于是同一张图层上会出现两套身份语义——拾取如实
 * 给 `id: null`，状态命令却装作知道身份。
 *
 * ## 校验一律前置于调用
 *
 * 非法参数（空 id、`NaN`、非对象状态）在**任何 SDK 调用之前**抛 `BMAP_INVALID_ARGUMENT`。
 * 不用 `try { … } catch { … }` 掩盖：官方对状态写入没有「部分成功」的承诺，把参数错误伪装成
 * SDK 失败会让调用方去检查一个根本没错的图层。
 *
 * 空 keys / 空 id 数组是**合法输入**（什么都不做，也不产生 SDK 调用）——它表达的是「本次没有
 * 要素要更新」，不是错误。空映射 `replace({})` 同理，它等价于 `clear()`。
 *
 * 「不支持」**不在这里判**：某一类图层有没有这个入口是 Driver 的事实（`supports()`），本模块
 * 直接调用，让 `BMAP_CAPABILITY_UNSUPPORTED` 从那一处抛出来。两处各判一次会分叉。
 *
 * 本文件是**框架无关**的（不 import vue）：入参只有归一化的 `NativeLayerDriver`、句柄取值器与
 * 一个组件名，因此可以在没有 Vue 的单测里直接驱动。
 */
import { BMapError } from "../errors/BMapError";
import { createDevWarnOnce } from "../logger";
import type {
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
  NativeLayerHandle,
} from "../../driver/types/native-layers";

/** 状态命令面的五个命令名（诊断与 `warnOnce` 的键都用它们）。 */
export type FeatureStateCommand = "update" | "remove" | "clear" | "replace" | "get";

export interface FeatureStateUpdateOptions {
  /**
   * `true` = 合并到该要素已有的状态对象；`false`（默认）= **替换**它的整个状态对象。
   *
   * 默认值刻意与官方一致（官方的 `ifAppend` 缺省即 false）：把「没表态」当成合并，会让
   * `update(id, { selected: true })` 之后的 `update(id, { hovered: true })` 静默保留 `selected`。
   */
  readonly append?: boolean;
}

export interface FeatureStateApi {
  update(
    keys: NativeLayerFeatureKeys,
    state: NativeLayerFeatureState,
    options?: FeatureStateUpdateOptions,
  ): void;
  remove(keys: NativeLayerFeatureKeys): void;
  clear(): void;
  replace(inputs: NativeLayerFeatureStateMap): void;
  /** 读回：不给 `keys` 就是全部；给了就只返回这些 id（不存在的 id 不会出现在结果里）。 */
  get(keys?: NativeLayerFeatureKeys): NativeLayerFeatureStateMap;
}

export interface CreateFeatureStateApiInput<Handle = NativeLayerHandle> {
  /**
   * **当前会话**（Driver + 句柄）的取值器；未就绪（或已释放）时返回 `null`。
   *
   * 每条命令都重新求值，而不是在创建时捕获两个引用，理由有两个：
   *
   * - 图层会因为构造期选项变化而**换实例**，闭包里的旧句柄会让状态写进一个已经不在地图上的图层
   *   ——那是最难查的一类「设置没生效」；
   * - 命令面通常在 `onMounted` **之前**就被 expose 出去了（父级 ref 一拿到就可能调用），而那时
   *   连 Driver 都还没解析出来。
   */
  session(): FeatureStateSession<Handle> | null;
  /**
   * **业务身份字段名**（构造期 `idKey` / MVT 的 `idProperty`）的取值器；没表态时返回 `undefined`。
   *
   * 身份未知时命令一律被拒绝（告警一次）——「按 id 定位」在没有身份字段的图层上没有意义，
   * 而放它过去就等价于悄悄依赖 SDK 的默认 `idKey`：同一个组件会在拾取上说「认不出身份」，
   * 在状态命令上却装作知道身份，那是两套身份语义（#106 评审的建议项）。
   */
  identity(): string | undefined;
  /** 调用方名字（组件名）：参数错误与「未就绪」的告警都点名它。 */
  component: string;
  /**
   * 身份字段的 prop 名（诊断文案用；默认 `"idKey"`）。
   *
   * MVT 的官方构造选项叫 `idProperty`，告警里若仍写 `idKey` 会把调用方指去一个不存在的 prop。
   */
  identityProp?: string;
  /**
   * 键域收窄。
   *
   * - `"default"`（缺省）：`string | number`（#36 NativeLayer 的官方签名）；
   * - `"string"`：**只收 string**（#109 MVT 的 `updateState(keys: string | Array<string>)`）。
   *   数字键在任何 SDK 调用之前被拒绝——MVT 的复合键 `layerName_id` 就是 string，
   *   放行 number 会让「1」与 1 在类型层是两套身份、在 SDK 侧却是同一个槽位。
   */
  keyDomain?: "default" | "string";
}

/**
 * 一次可用的命令会话（两个引用必须来自**同一时刻**，因此一起给，不给两个 getter）。
 *
 * `Handle` 默认 `NativeLayerHandle`（#36 的线 / 面图层）；`LayerDriver` 的要素状态面
 * （#109 `mvt`）用 `LayerHandle`，driver 形状由 `FeatureStateCommands` 约束——两侧结构同构，
 * 因此同一个 `createFeatureStateApi` 实现服务两个 Facet。
 */
export interface FeatureStateSession<Handle = NativeLayerHandle> {
  readonly driver: FeatureStateCommands<Handle>;
  readonly handle: Handle;
}

/**
 * 要素状态五命令的**最小结构**（`NativeLayerDriver` 与 `LayerDriver` 都满足它）。
 *
 * 刻意不写成 `NativeLayerDriver`：那是 #36 专属的宽接口；`mvt` 的句柄品牌是
 * `layer:mvt` 而不是 `native-layer:*`，用宽接口会迫使调用方做不安全断言。
 */
export interface FeatureStateCommands<Handle> {
  updateState(
    handle: Handle,
    keys: NativeLayerFeatureKeys,
    state: NativeLayerFeatureState,
    append?: boolean,
  ): void;
  removeState(handle: Handle, keys: NativeLayerFeatureKeys): void;
  clearState(handle: Handle): void;
  replaceState(handle: Handle, inputs: NativeLayerFeatureStateMap): void;
  getState(handle: Handle): NativeLayerFeatureStateMap;
}

/* ------------------------------------------------------------------ 校验 */

function invalidArgument(component: string, detail: string): BMapError {
  return new BMapError("BMAP_INVALID_ARGUMENT", `${component}: ${detail}`, { component });
}

/**
 * 单个业务 id 的可用性。
 *
 * 与 `core/data/itemScan.ts` 的 `isUsableItemKey` 同一条判定（有限数字 / 字符串）。`NaN` 尤其
 * 要拒绝——`NaN !== NaN`，写进去之后既查不回来也删不掉。
 *
 * 官方签名里只有 `string | number`（没有 symbol），这里就如实地只接受这两种：状态映射的键必须
 * 可序列化，symbol 身份进了 SDK 也换不回来。
 */
function isUsableId(value: unknown): value is string | number {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string";
}

/**
 * 归一化 keys：单个 id 或一批 id。空数组是合法的（= 什么都不做）。
 *
 * `keyDomain: "string"` 时数字键在任何 SDK 调用之前被拒绝（#109 MVT 的官方签名只收 string）。
 */
function normalizeKeys(
  component: string,
  keys: unknown,
  keyDomain: "default" | "string" = "default",
): Array<string | number> {
  const list = Array.isArray(keys) ? keys : [keys];
  const normalized: Array<string | number> = [];
  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index];
    if (keyDomain === "string" && typeof candidate !== "string") {
      throw invalidArgument(
        component,
        `feature state 的 id 必须是字符串（MVT 复合键 layerName_id），` +
          `实际下标 ${index} 是 ${describeValue(candidate)}`,
      );
    }
    if (!isUsableId(candidate)) {
      throw invalidArgument(
        component,
        `feature state 的 id 必须是有限数字或字符串（idKey 字段的值），` +
          `实际下标 ${index} 是 ${describeValue(candidate)}`,
      );
    }
    normalized.push(candidate);
  }
  return normalized;
}

/** 归一化状态对象：官方参数是 `params: object`（数组也是对象，但不表达「状态」）。 */
function normalizeState(component: string, state: unknown): NativeLayerFeatureState {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    throw invalidArgument(
      component,
      `feature state 的状态必须是对象（如 { selected: true }），实际是 ${describeValue(state)}`,
    );
  }
  return state as NativeLayerFeatureState;
}

/**
 * 归一化「业务 id → 状态」映射（`replace` 的入参）。
 *
 * 映射里的**每一个键**都要过身份判定：官方把它当成「一批要素的状态」而不是「一个对象的属性
 * 集合」，混进一个不可用的键只会让那一项静默失效。
 */
function normalizeStateMap(
  component: string,
  inputs: unknown,
): NativeLayerFeatureStateMap {
  if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw invalidArgument(
      component,
      `replace 的入参必须是「业务 id → 状态」的映射对象，实际是 ${describeValue(inputs)}`,
    );
  }
  const normalized: NativeLayerFeatureStateMap = {};
  for (const [key, state] of Object.entries(inputs as Record<string, unknown>)) {
    // Object.entries 的键在 JS 层永远是 string，keyDomain 对这条路径没有可拒的形态。
    if (!isUsableId(key)) throw invalidArgument(component, `replace 的映射键 "${key}" 不是合法 id`);
    normalized[key] = { ...normalizeState(component, state) };
  }
  return normalized;
}

/**
 * 错误文案里的取值描述。
 *
 * 对象只说类型 / 长度：状态写入的调用点常常在事件回调里，把整个状态对象打出来会污染日志。
 */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `数组（length ${value.length}）`;
  const type = typeof value;
  if (type === "number" || type === "string") return `"${String(value)}"`;
  if (type === "object") return "对象";
  return `"${type}"`;
}

/* ------------------------------------------------------------------ 命令面 */

export function createFeatureStateApi<Handle = NativeLayerHandle>(
  input: CreateFeatureStateApiInput<Handle>,
): FeatureStateApi {
  const { component, identityProp = "idKey", keyDomain = "default" } = input;
  /**
   * 告警去重**按命令面实例**而不是模块级：同一个组件挂两个实例时，模块级的键会让第二个实例的
   * 「未就绪」告警被第一个吞掉（而那正是它需要看到的信息）。
   */
  const warnOnce = createDevWarnOnce();

  /**
   * 未就绪时的统一出口：**不做任何事**，但要说出来。
   *
   * 刻意不抛（与 `<BMap>` 的 expose 同一条口径：命令面不该逼调用方写时序守卫），也刻意不排队
   * ——排队会让「什么时候生效」变成一个看不见的状态；调用方需要确定性时应当等到挂载完成。
   */
  const notReady = (command: FeatureStateCommand): void => {
    warnOnce(
      `${component}:${command}:not-ready`,
      `[${component}] ${command}() 在图层未就绪（或已释放）时被调用：本次不做任何事` +
        "（不排队、不补发）。需要确定性时请等到挂载完成后再调用",
    );
  };

  /**
   * **身份未声明**时的统一出口：同样不做任何事，同样要说出来（与 `notReady` 分开写，
   * 因为原因是两件事：一个是时序，一个是「这个图层根本没有身份字段」）。
   */
  const noIdentity = (command: FeatureStateCommand): void => {
    warnOnce(
      `${component}:${command}:no-identity`,
      `[${component}] ${command}() 需要一个业务身份字段，而本组件没有声明 ${identityProp}：` +
        "本次不做任何事——本库不猜 SDK 的默认 idKey（拾取在同样情况下也只会给出 id: null）。" +
        `请设置 ${identityProp} 后重试`,
    );
  };

  /**
   * 命令的统一前置：会话与身份都就绪才继续。返回 `null` = 本次不执行（原因已经告警过）。
   */
  const guard = (command: FeatureStateCommand): FeatureStateSession<Handle> | null => {
    const session = input.session();
    if (!session) {
      notReady(command);
      return null;
    }
    if (input.identity() === undefined) {
      noIdentity(command);
      return null;
    }
    return session;
  };

  return {
    update(keys, state, options) {
      const ids = normalizeKeys(component, keys, keyDomain);
      const params = normalizeState(component, state);
      if (ids.length === 0) return;
      const session = guard("update");
      if (!session) return;
      session.driver.updateState(session.handle, ids, params, options?.append ?? false);
    },

    remove(keys) {
      const ids = normalizeKeys(component, keys, keyDomain);
      if (ids.length === 0) return;
      const session = guard("remove");
      if (!session) return;
      session.driver.removeState(session.handle, ids);
    },

    clear() {
      const session = guard("clear");
      if (!session) return;
      session.driver.clearState(session.handle);
    },

    replace(inputs) {
      const map = normalizeStateMap(component, inputs);
      const session = guard("replace");
      if (!session) return;
      session.driver.replaceState(session.handle, map);
    },

    get(keys) {
      // 先归一化 keys：非法键（含 keyDomain: "string" 下的数字）必须在任何 SDK 调用之前失败，
      // 与 update / remove 同一条口径——否则 get([bad]) 会先打一次 getAllState 再抛。
      const wantedIds =
        keys === undefined ? null : normalizeKeys(component, keys, keyDomain).map((id) => String(id));
      const session = guard("get");
      if (!session) return {};
      const all = session.driver.getState(session.handle);
      if (wantedIds === null) return all;
      // 过滤口径与写入一致：`String(id)`（SDK 的映射键就是 id 的字符串形式）
      const wanted = new Set(wantedIds);
      const picked: NativeLayerFeatureStateMap = {};
      for (const [key, state] of Object.entries(all)) {
        if (wanted.has(key)) picked[key] = state;
      }
      return picked;
    },
  };
}

/**
 * MVT 要素状态的**复合键**：`layerName_id`（#109 live 探针实测的唯一有效键形）。
 *
 * 裸 id（`"1"` / `"feat-1"`）在真实 4.0 上只产生噪声级 Δ（探针读数：Δ87B vs 复合键 Δ2578B）。
 * `layerName` 是**源图层名**（MVT 数据里的 source-layer），不是地图上某一个 `Map` 的名字；
 * `id` 是该源图层里要素的身份（通常来自 `idProperty` 字段值，或拾取事件的 `Entity.id`）。
 *
 * 导出这一小段拼接而不是让调用方手写 `` `${a}_${b}` ``：键形一旦要变（例如上游改成 `:`），
 * 调用点只应有一处要改。
 */
export function mvtFeatureStateKey(layerName: string, id: string | number): string {
  return `${layerName}_${id}`;
}
