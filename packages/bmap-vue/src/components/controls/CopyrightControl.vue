<script setup lang="ts">
import { getCurrentInstance, onUpdated, ref } from "vue";
import { useControlResource, type ControlSpec } from "../../core/controls";
import type { MapReadyContext } from "../../core/context/types";
import { logger } from "../../core/logger";
import type { ControlHandle } from "../../driver/types/handles";
import {
  getCopyrightControl,
  removeCopyrightControlIfEmpty,
  setCopyrightControl,
} from "./copyrightControlPosCache";

/**
 * 延后摘除的重试节奏与次数（见 `deferCopyrightRemoval`）。
 *
 * live 读数的窗口是 126–167ms（`scripts/probe-165c-surface.mts`），因此一次 50ms 的等待
 * 就足以覆盖绝大多数情况；给 4 次 / 50ms（合计 200ms）是「窗口比读数更宽」时的余量，
 * **不**做成无界重试——无界重试在「成员面真的永远不来」时是一条永久在飞的定时器，
 * 而本仓库的泄漏门禁只认「能归零的资源」。
 */
const REMOVAL_RETRY_INTERVAL_MS = 50;
const REMOVAL_RETRY_ATTEMPTS = 4;

export interface CopyrightControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * CopyrightControl —— 版权控件（slot DOM 内容）
 *
 * 与其它控件共用统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41），但有两处**刻意覆盖**，
 * 因为它的实例是**按停靠位置共享**的（文档承诺「多个相同位置版权控件会自动排列，避免重叠」）：
 *
 * - `create` 经 `copyrightControlPosCache`（按 **Client + anchor** 分桶）复用同一 anchor 上已有的
 *   `CopyrightControl`；
 * - `mount` / `unmount` / `setVisible` 自己接管——「可见」在这一层是**版权项**的登记与摘除
 *   （`addCopyright` / `removeCopyright`），而不是整个控件的 `show()` / `hide()`：
 *   后者会连带隐藏兄弟组件登记在同一条控件上的内容。
 */
const props = withDefaults(defineProps<CopyrightControlProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  // 控件留白口径：`offset` 是**相对锚点**的留白，不是相对容器另一侧的边距。
  // 全库统一 18px（与 `LocationControl` / `CityListControl` 一致）——
  // 此前这里是 83，对一个 32px 宽的缩放按钮而言等于把它甩到容器中间。
  offset: () => ({ x: 18, y: 18 }),
  visible: true,
});

const containerRef = ref<HTMLElement | null>(null);
const id = getCurrentInstance()?.uid ?? Math.random();
let control: ControlHandle | null = null;
let readyContext: MapReadyContext | null = null;
let registered = false;
/**
 * **创建这个实例时**用的停靠位置。
 *
 * 卸载时必须按它（而不是当前 `props.anchor`）去退出共享组：`anchor` 是构造期项（变化即重建，
 * 见 Driver 里 `copyright.anchor` 的分类），因此卸载那一刻 `props.anchor` 已经是**新**值——
 * 拿它去删桶会删掉目标 anchor 上**别人的**缓存项，同一个位置上随后就会出现两个控件
 * （ 评审 P1 的复现）。
 */
let createdAnchor: string | null = null;

/** 与 `withDefaults` 的默认值同一份口径（`anchor` 在组件里恒有值）。 */
const anchorOf = (p: Readonly<CopyrightControlProps>): string =>
  p.anchor ?? "BMAP_ANCHOR_BOTTOM_RIGHT";

const spec: ControlSpec<CopyrightControlProps> = {
  kind: "copyright",
  options: (p) => ({ anchor: anchorOf(p), offset: p.offset }),

  create({ context, props: current }) {
    const anchor = anchorOf(current);
    createdAnchor = anchor;
    // 共享缓存按 **Client + anchor** 分桶：句柄的所有权绑定在创建它的 Client 上，
    // 跨 Client 复用会被 Driver 的注册表判成 `BMAP_HANDLE_FOREIGN`（见缓存模块的注释）。
    const cached = getCopyrightControl(context.client, anchor);
    if (cached) {
      control = cached;
      return cached;
    }
    const created = context.client.driver.controls.create("copyright", {
      anchor,
      offset: current.offset,
    });
    control = created;
    setCopyrightControl(context.client, anchor, created);
    return created;
  },

  mount({ context, resource, props: _current }) {
    // 共享实例可能已经挂过（兄弟组件登记在它上面）：Driver 侧的挂载记账会去重，
    // 这里无条件调用即可，不需要再自己读一遍版权项数量。
    context.client.driver.controls.add({ kind: "map", handle: context.map }, resource);
    readyContext = context;
    registerCopyright();
  },

  unmount({ context, resource }) {
    // 摘除**可能延后**（见 `deferCopyrightRemoval`：官方控件成员面在 loader 判就绪之后
    // 约 150ms 才补齐，`removeCopyright` 属于后补的那一批）。
    //
    // 两条路径都必须走完「退出共享组 + 摘控件」，所以这两件事**不**放进延后闭包里——
    // 控件是**按 (Client, anchor) 共享**的：若窗口内把它留在图上，后续同 anchor 的组件会
    // 共用一个已经残留的实例，而它的缓存条目也没人淘汰（ 评审 P1 的第一种症状）。
    // 真正需要延后的只有**版权项本身**那一条 SDK 记录。
    deferCopyrightRemoval(context, resource, id);
    registered = false;
    // 用**创建时**的 anchor 退出共享组（`props.anchor` 可能已经是新值，见 `createdAnchor`）
    const anchor = createdAnchor ?? anchorOf(props);
    createdAnchor = null;
    // `id` 作为 `exceptId`：本组件自己那条在窗口内**摘不掉**（它此刻还在 SDK 上），
    // 但它属于一个**已经卸载**的组件，不能因此把共享控件留在图上（`removeCopyrightControlIfEmpty`
    // 的注释展开了这条）。
    removeCopyrightControlIfEmpty(anchor, resource, context, id);
    if (control === resource) control = null;
    readyContext = null;
  },

  setVisible({ context, resource, visible }) {
    if (visible) {
      registerCopyright();
      return;
    }
    deferCopyrightRemoval(context, resource, id);
    registered = false;
  },
};

useControlResource(props, spec);

function registerCopyright() {
  if (registered || !props.visible || !control || !readyContext || !containerRef.value) return;
  const ctx = readyContext;
  let bounds: unknown;
  try {
    bounds = ctx.client.driver.map.getBounds(ctx.map);
  } catch {
    bounds = undefined;
  }
  ctx.client.driver.controls.addCopyright(control, {
    id,
    content: containerRef.value.innerHTML,
    bounds,
  });
  registered = true;
}

/**
 * 动态内容（`{{ count }}` 这类）变化后重写本组件那一条版权项。
 *
 * `addCopyright` 按 id upsert，回读是为了**保留旧 bounds**（丢掉它会「内容变了但适用范围
 * 变回全局」，Driver 的 `listCopyrights` 因此一并回读 `bounds`）。
 */
onUpdated(() => {
  if (!control || !containerRef.value || !registered || !readyContext) return;
  const ctx = readyContext;
  const current = ctx.client.driver.controls
    .listCopyrights(control)
    .find((item) => item.id === id);
  if (!current || current.content === containerRef.value.innerHTML) return;
  ctx.client.driver.controls.addCopyright(control, {
    id,
    content: containerRef.value.innerHTML,
    bounds: current.bounds,
  });
});

/**
 * 摘掉一条版权项；**成员面尚未补齐**时延后到补齐之后再摘。
 *
 * ## 为什么需要延后，而不是「调用失败就跳过」
 *
 * 审计的结论是「`removeCopyright` 运行时不存在，卸载必抛 ⇒ 控件永远不摘、缓存永不淘汰」。
 * 复核（`scripts/probe-165c-surface.mts`，live AK）否掉了「不存在」这个前提：稳定态
 * `removeCopyright` **在位且调得动**。但复核取到一条**真的**，而且形状几乎一样：
 *
 * > **官方 loader 判「已加载」的那一下（`__bmapJSApiOnLoad_N` callback），早于控件成员面
 * > 补齐约 150ms。**窗口内 `addCopyright` / `getCopyright` / `getCopyrightCollection`
 * > **已经可用**（属于先到的 8 成员那批），而 `removeCopyright` **还不在**（后补的那批）。
 *
 * 本库从 loader 判就绪就开始建图、建控件，因此**窗口是可达的**：控件挂上了、版权项登记了，
 * 紧接着卸载时 `removeCopyright` 不存在 ⇒ `callRequired` 抛 `BMAP_SDK_CALL_FAILED` ⇒
 * 后面退出共享组与摘控件的代码整段被跳过（本组件的 `unmount`、以及
 * `removeCopyrightControlIfEmpty`）。
 *
 * 三条可选处置与各自的代价：
 *
 * | 处置 | 后果 |
 * | --- | --- |
 * | 静默跳过（`callControl` 的 warn-and-ignore） | **版权项永久留在 SDK 上**——它已经 add 成功了，没人再摘它。控件被摘下后这条内容可能仍以 SDK 内部缓存的形式存在 |
 * | 只做「摘控件 / 出缓存」 | 同上的尾巴，且没有补做的那一步 |
 * | **延后到成员补齐之后再摘**（本函数） | 版权项在 SDK 上多留 ≤ 一个窗口（~150ms），之后被真的摘掉；期间组件已卸载、控件已摘下，用户不可见 |
 *
 * 选第三条的依据是「**补齐是追溯的**」：live 实测「窗口里 add 的那条，窗口之后能 remove 掉」——
 * 因为被补的是**原型**，已存在的实例自动获得成员。因此延后不是「赌一次重试」，而是确定会生效。
 *
 * ## 为什么延后只覆盖**摘除**，不覆盖**登记**
 *
 * `addCopyright` 属于先到的那批（窗口内可调，live 实测 `collectionAfterAdd: array(1)`），
 * 所以 `registerCopyright` 不用改。反过来若哪天 `addCopyright` 也落到后补那一批，
 * 窗口内挂载会先失败——那是**另一个**问题（控件建起来却没有版权项），不该由本函数顺带掩盖。
 *
 * ## 定时器归属
 *
 * 延后用 `window.setTimeout` 而**不**登记进 `useControlResource` 的实例 scope：scope 在卸载时
 * 就 dispose 了，把补做挂上去等于让它**永远不执行**（那正是本函数要避免的静默失败）。
 * 代价是这个定时器不在组件的释放路径上——因此它做的是**幂等且可空**的补做
 * （摘一条已经登记的版权项），且必须告警（见下）。
 */
function deferCopyrightRemoval(
  context: MapReadyContext,
  resource: ControlHandle,
  copyrightId: number,
): void {
  const controls = context.client.driver.controls;
  if (!controls.canRemoveCopyright(resource)) {
    // 成员不在 = 落在运行时成员面窗口内。补做一次；失败则**说出来**（不静默）。
    logger.warn(
      "CopyrightControl: 当前 CopyrightControl 实例还没有 removeCopyright()（官方 4.0 的控件" +
        "成员面在 loader 判就绪之后约 150ms 才补齐），已把本次摘除延后；补做失败时该版权项会" +
        "残留在 SDK 上——这不是静默 no-op，请留意这条告警",
    );
    scheduleRemovalRetry(context, resource, copyrightId);
    return;
  }
  // 稳定态：直接摘。延后路径是**例外**处置，不是常态——正常路径不建任何定时器。
  controls.removeCopyright(resource, copyrightId);
}

/** 补做一次摘除；成员仍未就绪则有限次重试。 */
function scheduleRemovalRetry(
  context: MapReadyContext,
  resource: ControlHandle,
  copyrightId: number,
): void {
  const attempt = (remaining: number) => {
    window.setTimeout(() => {
      const controls = context.client.driver.controls;
      if (controls.canRemoveCopyright(resource)) {
        controls.removeCopyright(resource, copyrightId);
        return;
      }
      if (remaining > 0) {
        attempt(remaining - 1);
        return;
      }
      logger.warn(
        `CopyrightControl: 延后摘除版权项 ${String(copyrightId)} 仍未成功（成员面一直没有就绪），` +
          "该版权项残留在 SDK 上",
      );
    }, REMOVAL_RETRY_INTERVAL_MS);
  };
  attempt(REMOVAL_RETRY_ATTEMPTS);
}

defineOptions({ name: "CopyrightControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
