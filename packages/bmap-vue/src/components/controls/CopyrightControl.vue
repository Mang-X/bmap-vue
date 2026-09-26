<script setup lang="ts">
import { getCurrentInstance, onUpdated, ref } from "vue";
import { useControlResource, type ControlSpec } from "../../core/controls";
import type { MapReadyContext } from "../../core/context/types";
import type { ControlHandle } from "../../driver/types/handles";
import {
  getCopyrightControl,
  removeCopyrightControlIfEmpty,
  setCopyrightControl,
} from "./copyrightControlPosCache";

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
 * （#95 评审 P1 的复现）。
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
    context.client.driver.controls.removeCopyright(resource, id);
    registered = false;
    // 用**创建时**的 anchor 退出共享组（`props.anchor` 可能已经是新值，见 `createdAnchor`）
    const anchor = createdAnchor ?? anchorOf(props);
    createdAnchor = null;
    removeCopyrightControlIfEmpty(anchor, resource, context);
    if (control === resource) control = null;
    readyContext = null;
  },

  setVisible({ context, resource, visible }) {
    if (visible) {
      registerCopyright();
      return;
    }
    context.client.driver.controls.removeCopyright(resource, id);
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

defineOptions({ name: "CopyrightControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
