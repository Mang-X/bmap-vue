/**
 * `native` 聚合引擎（M6-POINT-CLUSTER / issue #35）—— `MarkerCluster` 的**默认**路径
 *
 * 落地在官方扩展 API `BMap.ClusterLayer`（运行时存在、`@baidumap/jsapi-v4-types@4.0.4` 无类声明、
 * 可视化实现按需异步注入）。它是本票「原生层是默认路径」的落点。
 *
 * ## 实测依据（`scripts/probe-native-point-cluster.mts`，真实 AK + headless Chrome）
 *
 * | 读数 | 值 |
 * | --- | --- |
 * | 构造 / 挂载 / `setData` | 全部成功 |
 * | 聚簇产出 | `change` 事件派发 `{ clusters, singles, zoom }`（40 个近点聚成 1 簇） |
 * | 选项 | 传进去的选项被采纳（`getOptions()` 回读）；**不传就什么都不写**（见决策 2） |
 * | **簇**命中载荷 | `{ isCluster: true, clusterId, parentId, pointCount, latLng, bbox, properties }` |
 * | **单点**命中载荷 | `{ id: "k-far-0", isCluster: false, … }` ⇒ 业务键在 `value.id` / `value.properties` 上 |
 * | `setVisible(false)` | 成功，`getVisible() === false`，可恢复 |
 *
 * ## 四处由读数（或读数缺失）决定的取舍
 *
 * 1. **簇命中拿不到业务项**：官方只给簇的元数据，`getClusterLayer().getItems()` 也只有簇级条目
 *    ⇒ `cluster-click` 的 `items` 为 `null`（不是空数组：让「拿不到」与「确实是空的」分得开）。
 * 2. **不猜官方默认值**：不传 `clusterRadius` / `clusterMinPoints` / `fitViewOnClick` 时，
 *    本库**不补一个数字**——官方默认值由 SDK 自己决定，本库不认识它们（同 #34 决策 6 与
 *    `pointLayerSpec.ts` 的口径）。探针实测「什么都不传也能聚簇」，因此这条不做任何事。
 *    代价：组件文档不能承诺「默认 60 像素」，只能说「未提供时由 SDK 决定」。
 * 3. **聚合参数是构造期选项 ⇒ 变化重建实例**：官方扩展专页同时列了 `setOptions` 与 `redraw`，
 *    但**没有取证**「改了参数再 `redraw()` 真的会重新聚簇」⇒ 本库不赌它。
 * 4. **`visible` 走 `setVisible`**（不是摘掉图层）：#35 专门取证的，也是 Driver 对 `cluster`
 *    唯一放开的继承成员。
 *
 * ## 与点图层内核的两处刻意不同（不要为了「看着一样」去统一）
 *
 * - 这里**没有** profile：聚合的选项面/事件面与点图层不同构，硬套一份声明反而会出现
 *   「profile 里一半字段对某个 kind 无意义」的假抽象。
 * - 这里**没有** `supports()` 前置校验：本引擎只碰 Driver 对 `cluster` 明确声明的操作
 *   （`setData` / `clearData` / `create` / `add` / `remove` / `setVisible` / `setStyle`），
 *   不读任何 props 决定「要不要调某个 setter」——那正是点图层内核需要 `supports()` 的原因。
 */
import { nativeLayersOf } from "../../core/layers/nativeLayerAccess";
import { layerInputFingerprint, stableLayerValue } from "../../core/layers/LayerSpec";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { adaptPoints, resolveIdField, type AdaptedPoints } from "../../core/data/geojsonAdapter";
import { itemKeyReader } from "../../core/data/itemScan";
import { createProblemReporter } from "../../core/data/problems";
import { createItemIndex, type ItemIndex } from "../../core/data/itemIndex";
import { readPickValue } from "../../core/layers/nativeLayerPick";
import { readPayloadPointLike } from "../../core/data/points";
import { devWarn } from "../../core/logger";
import type { ClusterEngine, ClusterEngineInput } from "./clusterEngine";
import type { MarkerClusterEngine } from "../../types/components";
import type { LayerRecord, LayerRegistry } from "../../core/layers/LayerRegistry";
import type { MapReadyContext } from "../../core/context/types";
import type { NativeLayerHandle } from "../../driver/types/native-layers";
import type { PointLike } from "../../core/data/points";

/** 引擎真正读的 props（`MarkerClusterProps` 的结构子集）。 */
export interface NativeClusterEngineProps<Item> {
  readonly data: readonly Item[];
  readonly itemKey: keyof Item | ((item: Item) => PropertyKey);
  readonly getPosition: (item: Item) => PointLike | null | undefined;
  readonly dataVersion?: PropertyKey;
  readonly visible?: boolean;
  readonly clusterRadius?: number;
  readonly clusterMinPoints?: number;
  readonly clusterMinZoom?: number;
  readonly clusterMaxZoom?: number;
  readonly fitViewOnClick?: boolean;
  readonly singleStyle?: Record<string, unknown>;
}

export interface NativeClusterEngineInput<Item> extends ClusterEngineInput<Item> {
  /** 图层账本（由 SFC 解析：`ctx.layers` 或组件自持的兜底账本）。 */
  readonly registry: LayerRegistry;
}

export function createNativeClusterEngine<Item>(
  input: NativeClusterEngineInput<Item>,
  props: NativeClusterEngineProps<Item>,
): ClusterEngine<Item> {
  const { ready, registry, onClusterClick, onItemClick, onChange } = input;
  const label = input.label;
  const reports = createProblemReporter(label, (message) => devWarn(message));
  const items: ItemIndex<Item> = createItemIndex<Item>();

  let handle: NativeLayerHandle | null = null;
  let record: LayerRecord | null = null;
  /**
   * 本代的 child scope（业务监听挂这里）。**每代一个**：重建时旧 scope 连同旧实例一起作废。
   *
   * ⚠️ 不能做成引擎级的一份：`ResourceScope.dispose()` 之后再 `add()` 会**立刻执行**那个
   * disposer（`ResourceScope` 的既有语义），于是重建之后新实例的监听会在绑上的同一刻被摘掉 ——
   * 表现是「改一次聚合参数，点击就永久失效」。同一个坑在点图层内核里是「每实例一个 scope」规避的。
   */
  let listenerScope: ResourceScope | null = null;
  /** 最近一次送给 SDK 的适配结果（业务键的兜底查找要用同一份数据）。 */
  let adapted: AdaptedPoints<Item> | null = null;
  let appliedDataKey = "";
  let appliedVisible: boolean | null = null;
  /** 当前实例的构造期指纹；**只在创建成功后**提交（失败不推进记账，下次 sync 会重试）。 */
  let instanceKey = "";
  let warnedUnresolved = false;
  let warnedIncompleteHit = false;
  /**
   * 上一次严格摘除是否**未确认**（`removeLayer` 抛错 ⇒ 旧图层可能已不在图上）。
   *
   * ⚠️ 这个状态**由本引擎自持**：账本（`LayerRegistry`）不复制挂载态 —— 那是消费方的事实
   * （#112 评审指出 record 会在资源实际 detached 时持续报告 attached，属「重复且说谎的状态源」）。
   */
  let detachUnknown = false;
  /**
   * 摘除期间的业务回调门（由账本的严格 `detach()` 打开 / 关闭）。
   *
   * 摘除期间 SDK 可能同步派发事件，而这一代实例正在被拆。失败时门关掉、监听恢复；但资源那一侧
   * 只能是 `unknown`（可能已被摘除、也可能仍在图上），因此这里**不宣称「旧引擎完整恢复」**。
   */
  let quiescing = false;

  const target = { kind: "map" as const, handle: ready.map };
  const nativeLayers = (): ReturnType<typeof nativeLayersOf> => nativeLayersOf(ready.client);

  /**
   * 构造期指纹：聚合参数 / 身份字段变化 ⇒ 换实例（见文件头第 3 条）。
   *
   * `singleStyle` 走仓库里唯一一份稳定值指纹（`stableLayerValue`）：按对象引用比会让
   * 「父级每次渲染传字面量」都判成变了，于是每帧重建一次图层。
   */
  function instanceFingerprint(): string {
    return [
      "cluster",
      resolveIdField(props.itemKey),
      props.clusterRadius,
      props.clusterMinPoints,
      props.clusterMinZoom,
      props.clusterMaxZoom,
      props.fitViewOnClick,
      stableLayerValue(props.singleStyle),
    ].join("|");
  }

  /**
   * 构造选项：**只写用户表过态的键**（不补官方默认值，见文件头第 2 条）。
   *
   * 拾取是硬编码的：`cluster-click` / `item-click` 是这个组件的核心交互，而官方扩展专页把
   * `enablePicked` 写在示例里；本库没有「关掉拾取」的消费者，因此不暴露成 prop
   * （收下一个不知道会不会生效的开关属于假支持）。
   */
  function constructorOptions(idKey: string): Record<string, unknown> {
    const options: Record<string, unknown> = { idKey, enablePicked: true };
    if (props.clusterRadius !== undefined) options.clusterRadius = props.clusterRadius;
    if (props.clusterMinPoints !== undefined) options.clusterMinPoints = props.clusterMinPoints;
    if (props.clusterMinZoom !== undefined) options.clusterMinZoom = props.clusterMinZoom;
    if (props.clusterMaxZoom !== undefined) options.clusterMaxZoom = props.clusterMaxZoom;
    if (props.fitViewOnClick !== undefined) options.fitViewOnClick = props.fitViewOnClick;
    if (props.singleStyle !== undefined) options.singleStyle = props.singleStyle;
    return options;
  }

  function dataInputKey(): string {
    // 与点图层内核同一条口径（同一份 `layerInputFingerprint`）：`data` 按**引用**算身份、
    // 函数按源码折叠、其余按取值。**不要**用 `String(data)`：对象数组的 `String()` 结果与元素
    // 无关（`[object Object],…`），换数据会被判成没变，`item-click` 就会一直回传旧对象。
    return [
      layerInputFingerprint(props.data),
      props.dataVersion === undefined ? "·" : String(props.dataVersion),
      layerInputFingerprint(props.itemKey),
      layerInputFingerprint(props.getPosition),
    ].join("|");
  }

  /** key → 最新业务项（`item-click` 要回传**最新**对象，不是点那一刻闭包里的旧对象）。 */
  function rememberItems(next: AdaptedPoints<Item>): void {
    const readKey = itemKeyReader(props.itemKey);
    items.replace(next.items.map((item) => ({ key: readKey(item), item })));
  }

  function createInstance(): void {
    const next = adaptPoints(props.data, {
      itemKey: props.itemKey,
      getPosition: props.getPosition,
      onProblem: (problem) => reports.report(problem),
    });
    const created = nativeLayers().create("cluster", constructorOptions(next.idKey));
    const scope = new ResourceScope({ label: `${label}:native-cluster` });
    const key = instanceFingerprint();
    // 账本先登记：任何一步抛错时，卸载路径上一定有一个「能把它从图上摘掉」的记录。
    const createdRecord = registry.register({
      kind: "cluster",
      handle: created,
      scope,
      // 摘除期间挡业务回调（可恢复）
      quiesce: (active) => {
        quiescing = active;
      },
      remove: () => {
        // ⚠️ 顺序：**先摘、后销账**。反过来（先 `handle = null`）时，一次抛错的 `removeLayer`
        // 会把这个引擎的记账清成「已经没有实例了」，于是重试路径（`detach()` 的 `if (!handle) return`）
        // 直接跳过摘除 —— 旧图层留在图上、新引擎照样挂上去。
        nativeLayers().remove(target, created);
        if (handle === created) handle = null;
      },
    });
    try {
      nativeLayers().add(target, created);
      bindEvents(created, scope);
      writeData(created, next);
      if (props.visible === false) {
        nativeLayers().setVisible(created, false);
        appliedVisible = false;
      } else {
        appliedVisible = true;
      }
      reports.flush();
    } catch (error) {
      createdRecord.dispose();
      if (!scope.isDisposed) scope.dispose(`${label}-native-cluster-create-failed`);
      throw error;
    }
    // **成功之后**才提交记账：失败时这几个变量保持原样，下一次 sync 会重新走「建实例」这条路，
    // 而不是因为「指纹没变」被判成「实例还在」而静默跳过。
    handle = created;
    record = createdRecord;
    listenerScope = scope;
    adapted = next;
    appliedDataKey = dataInputKey();
    instanceKey = key;
  }

  /**
   * 数据写入（空数据走 `clearData`，与点图层内核同一条规则）。
   *
   * `appliedDataKey` 由调用方在成功后提交（`createInstance` 统一提交；`applyData` 自己提交）。
   */
  function writeData(layer: NativeLayerHandle, next: AdaptedPoints<Item>): void {
    rememberItems(next);
    if (next.data.features.length === 0) nativeLayers().clearData(layer);
    else nativeLayers().setData(layer, next.data as unknown as Record<string, unknown>);
  }

  function disposeInstance(): void {
    // 门禁用 `record`（**所有权token**）而不是 `handle`：一次抛错的 `removeLayer` 之后
    // `handle` 可能已经被摘除回调清掉，但资源的所有权仍在账本记录上 —— 用 `handle` 当门禁会
    // 让「摘除失败」变成「永远不再摘」。
    if (!record) return;
    record.dispose();
    record = null;
    listenerScope = null;
    handle = null;
  }

  function bindEvents(layer: NativeLayerHandle, scope: ResourceScope): void {
    const events = ready.client.driver.events;
    scope.add(
      events.on(layer, "click", (event) => {
        if (quiescing) return;
        handleClick(event);
      }),
    );
    // `change` 是官方给出的聚合结果读数（`{ singles, clusters, zoom }`）：**原样转发**，
    // 不在组件里存一份「当前有几簇」的镜像状态（ownership-first）。
    scope.add(
      events.on(layer, "change", (event) => {
        if (quiescing) return;
        handleChange(event);
      }),
    );
  }

  function handleChange(event: unknown): void {
    const value = readPickValue(event) as { clusters?: unknown; singles?: unknown; zoom?: unknown } | undefined;
    if (!value || typeof value !== "object") return;
    onChange({
      clusters: Array.isArray(value.clusters) ? value.clusters.length : 0,
      singles: Array.isArray(value.singles) ? value.singles.length : 0,
      // 读不到就如实给 `null`，不编一个数字（同点图层内核「读不到要素下标就给 -1」的口径）
      zoom: typeof value.zoom === "number" ? value.zoom : null,
    });
  }
  /**
   * 命中载荷 → 簇点击 / 单点点击。
   *
   * 两种命中的判据不同（都来自实测）：簇看 `value.isCluster === true`；单点看能不能从
   * `value.id` / `value.properties[idKey]` 解析出业务身份。
   */
  function handleClick(event: unknown): void {
    const value = readPickValue(event) as
      | {
          isCluster?: unknown;
          clusterId?: unknown;
          pointCount?: unknown;
          latLng?: unknown;
          id?: unknown;
          properties?: unknown;
        }
      | undefined;
    if (!value || typeof value !== "object") return;

    if (value.isCluster === true) {
      // 必要元数据不完整 ⇒ **停止派发**。公开类型把 `id` / `size` / `position` 声明成必填的
      // 合法值，塞进 `(0,0)` / `0` / `""` 会把「SDK 载荷不完整」伪装成一个真实业务簇，而调用方
      // 无从分辨。告警一次并如实表态：这一次没有可信的簇读数。
      const position = readPayloadPointLike(value.latLng);
      const size = typeof value.pointCount === "number" ? value.pointCount : null;
      const id = value.clusterId;
      if (!position || size === null || id === undefined || id === null) {
        if (!warnedIncompleteHit) {
          warnedIncompleteHit = true;
          const missing = [
            position ? null : "latLng",
            size === null ? "pointCount" : null,
            id === undefined || id === null ? "clusterId" : null,
          ].filter((field): field is string => field !== null);
          devWarn(
            `${label}：簇命中载荷缺少 ${missing.join(" / ")}（官方扩展 API 的载荷形状以实测为准），` +
              "本次**不派发** cluster-click —— 用占位值伪造一个合法业务簇会让调用方无从分辨",
          );
        }
        return;
      }
      onClusterClick({
        id: String(id),
        size,
        position,
        // 官方没有公开「簇里有哪几个业务项」的读回入口 ⇒ 如实给 null（见组件文档与 ADR）
        items: null,
      });
      return;
    }

    const key = featureKey(value);
    if (key !== undefined) {
      const latest = items.latest(key);
      if (latest !== undefined) {
        onItemClick(latest);
        return;
      }
    }
    if (!warnedUnresolved) {
      warnedUnresolved = true;
      devWarn(
        `${label}：命中了单点但取不到业务项（原生聚合的命中载荷里没有要素下标，业务键要从 ` +
          "value.id / value.properties[idKey] 上读）。若数据刚被替换过，这一帧可能已经过期",
      );
    }
  }

  /** 单点命中的业务键：`value.id` 优先，其次 `value.properties[idKey]`。 */
  function featureKey(value: { id?: unknown; properties?: unknown }): PropertyKey | undefined {
    const candidate =
      value.id ??
      (value.properties && typeof value.properties === "object"
        ? (value.properties as Record<string, unknown>)[adapted?.idKey ?? ""]
        : undefined);
    if (typeof candidate === "string" || typeof candidate === "symbol") return candidate;
    if (typeof candidate === "number" && !Number.isNaN(candidate)) return candidate;
    return undefined;
  }

  function applyData(): void {
    if (!handle) return;
    // 挂载态 `unknown` ⇒ 一个字都不写（它可能已经不在图上）。收敛交给下一次替换路径：
    // `recreate()` → `record.detach()`，账本会把 `unknown` 收敛成确定状态。
    if (detachUnknown) return;
    const key = dataInputKey();
    if (key === appliedDataKey && adapted) return;
    const next = adaptPoints(props.data, {
      itemKey: props.itemKey,
      getPosition: props.getPosition,
      onProblem: (problem) => reports.report(problem),
    });
    writeData(handle, next);
    adapted = next;
    appliedDataKey = key;
    reports.flush();
  }

  /**
   * 显隐的**唯一**写入点（props watcher 与 `sync()` 都走它）。
   *
   * `appliedVisible` 只在成功后推进：失败的显隐不是「已完成」，下一次收敛会重试
   * （否则一次 SDK 异常会把声明与画面永久分叉）。
   */
  function applyVisible(): void {
    if (!handle) return;
    // 同 `applyData`：挂载态未知时不写
    if (detachUnknown) return;
    const desired = props.visible !== false;
    if (appliedVisible === desired) return;
    nativeLayers().setVisible(handle, desired);
    appliedVisible = desired;
  }

  /**
   * 换实例：先摘成功、再建新的（**严格路径**：`record.detach()` 先解绑监听、再摘资源，
   * 摘除失败会抛 ⇒ 调用方保留旧实例）。
   */
  /**
   * **严格摘除当前实例，并同步 `detachUnknown`** —— 两条入口（构造期重建 / 换引擎）**共用**。
   *
   * - 成功 ⇒ 确定已摘除：清掉 `detachUnknown`；
   * - `record.detach()` 抛错 ⇒ 资源**可能已经不在图上** ⇒ 置 `detachUnknown = true` 后原样抛出，
   *   调用方据此放弃这次重建 / 切换，并保留旧实例（记账不清理，下一次还能再试）。
   *
   * 为什么必须共用：`recreate()`（构造期项变化）与公开的 `detach()`（换引擎）是**两条入口**，
   * 各写一份 catch 的结果就是「一条记了 unknown、另一条没记」—— 第四轮评审的同一条原则漏在了
   * 另一条入口上（#108 本轮评审）。未知状态下 `applyData` / `applyVisible` 都不写，`sync()`
   * 优先收敛，所以这个标志必须两条入口都维护。
   */
  function detachStrict(): void {
    const current = record;
    if (!current) return;
    try {
      current.detach();
    } catch (error) {
      detachUnknown = true;
      throw error;
    }
    detachUnknown = false;
  }

  function recreate(): void {
    const old = handle;
    if (old) {
      // 失败时**不清理任何记账**：旧的还在图上，下一次 sync / 卸载还要能再摘一次
      detachStrict();
      record = null;
      listenerScope = null;
      handle = null;
    }
    createInstance();
  }

  const kind: MarkerClusterEngine = "native";

  return {
    kind,
    mount() {
      createInstance();
    },
    sync() {
      /**
       * ⚠️ **`unknown` 优先于构造指纹**：挂载态未知是「必须先收敛」的状态，不能让指纹相同把它
       * 永久冻住。否则有一个稳定复现：key 60 → 改 80 时 after-detach 抛错（实例可能已不在图上）⇒
       * 用户把参数改回 60 ⇒ 指纹又等于 `instanceKey` ⇒ 后续数据/显隐更新只会被未知门静默挡掉，
       * **再也没有任何收敛动作**（组件可能永久空白，且除第一次错误外没有任何信号）。
       *
       * 收敛本身走 `recreate()` → `record.detach()`（受控地再摘一次，成功即确定已摘除，
       * 依据是 #98 的 live 实测：对已经摘掉的图层重复 `removeLayer` 安全）。
       */
      if (detachUnknown) {
        recreate();
        return;
      }
      if (instanceFingerprint() !== instanceKey) {
        recreate();
        return;
      }
      applyData();
      // 未生效的显隐在这里被补上（`appliedVisible` 只在成功后推进）
      applyVisible();
    },
    setVisible() {
      applyVisible();
    },
    dispose() {
      disposeInstance();
      items.clear();
      adapted = null;
    },
    detach() {
      // 严格路径：失败时**不清理任何记账**，调用方会放弃换引擎并保留本引擎
      // （旧的还在图上 ⇒ 下一次还能再试；清掉记账等于让它没人认领）。
      // 门禁同样用 `record`（所有权）而不是 `handle`（可能已被回调清掉）。
      if (!record) return;
      // 与 `recreate()` **共用**同一条严格摘除（含 `detachUnknown` 记账）：这条入口是「换引擎」，
      // 失败后外层会保留本引擎 ⇒ 之后单改 `visible` / 取消切换时都必须按未知句柄处理。
      detachStrict();
      record = null;
      listenerScope = null;
      handle = null;
      items.clear();
      adapted = null;
    },
  };
}
