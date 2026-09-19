<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { useParentOverlayHandle } from "../../core/context/target";
import type { MapReadyContext } from "../../core/context/types";
import type { OverlayHandle, SdkHandle } from "../../driver/types/handles";
import type { BMapClient } from "../../client/types";

/**
 * BContextMenu —— 右键菜单
 *
 * 通过 typed overlay context 取得最近父 Overlay(或 map),
 * 不通过广播。父 Overlay 不存在时回退到 map。
 *
 * target 原子切换——从旧 target 移除后再挂到新 target；
 * visible=false 时 detach；open/close 只对应 SDK 真正展开/关闭事件。
 */
export interface ContextMenuItem {
  text: string;
  callback: (...args: any[]) => void;
  disabled?: boolean;
}
export type ContextMenuSeparator = "-";

export interface BContextMenuProps {
  width?: number;
  visible?: boolean;
  menuItems?: (ContextMenuItem | ContextMenuSeparator)[];
}

const props = withDefaults(defineProps<BContextMenuProps>(), {
  width: 100,
  visible: true,
  menuItems: () => [],
});

const emit = defineEmits<{
  open: [];
  close: [];
}>();

const ctx = useRequiredMapContext();
const scope = new ResourceScope({ label: "context-menu" });
// 每个菜单实例独立 child scope:重建时释放旧菜单的 SDK 事件绑定,避免堆积
let menuScope: ResourceScope | null = null;
// 最近父 Overlay 实例(读 TargetContext;不在 overlay 下则为 null)
// shallowRef 响应父 Marker 晚于自身就绪,watch immediate 自动原子挂载
const parentOverlay = useParentOverlayHandle();

let contextMenu: OverlayHandle | null = null;
let currentTarget: SdkHandle<string> | null = null;
let readyCtx: MapReadyContext | null = null;

function buildMenu(client: BMapClient) {
  const menu = client.driver.overlays.createContextMenu({ width: props.width });
  for (const item of props.menuItems ?? []) {
    if (item === "-") {
      client.driver.overlays.addContextMenuItem(menu, "-");
      continue;
    }
    const i = item as ContextMenuItem;
    client.driver.overlays.addContextMenuItem(
      menu,
      {
        text: i.text,
        callback: (point, pixel) => {
          // point 解析失败（如 SDK 回调携带空点）不得阻断菜单动作本身
          let normPoint: { lng: number; lat: number } | undefined;
          try {
            normPoint = client.driver.geometry.fromRawPoint(point);
          } catch {
            normPoint = undefined;
          }
          i.callback({
            point: normPoint,
            pixel: pixel ? client.driver.geometry.fromRawPixel(pixel) : undefined,
            map: ctx.map.value,
            target: currentTarget,
          });
        },
      },
      { width: props.width },
    );
  }
  return menu;
}

/** 原子切换——先从旧 target 移除，再挂到新 target */
function attachTo(next: SdkHandle<string> | null) {
  const previous = currentTarget;
  const client = readyCtx?.client ?? ctx.client.value;
  if (previous && previous !== next && contextMenu && client) {
    try {
      client.driver.overlays.detachContextMenu(
        { kind: "overlay", handle: previous },
        contextMenu,
      );
    } catch {
      /* 忽略旧 target 移除错误 */
    }
  }
  currentTarget = next;
  if (currentTarget && contextMenu && props.visible !== false && client) {
    try {
      client.driver.overlays.attachContextMenu(
        { kind: "overlay", handle: currentTarget },
        contextMenu,
      );
    } catch {
      /* 忽略挂载错误 */
    }
  }
}

function detach() {
  const client = readyCtx?.client ?? ctx.client.value;
  if (currentTarget && contextMenu && client) {
    try {
      client.driver.overlays.detachContextMenu(
        { kind: "overlay", handle: currentTarget },
        contextMenu,
      );
    } catch {
      /* 忽略 */
    }
  }
}

/** menuItems 变化：SDK 无增量能力时原子重建菜单 */
function rebuildMenu() {
  if (!readyCtx) return;
  detach();
  // 释放旧菜单实例 child scope(含其 open/close 事件绑定),再 fork 新实例 scope
  menuScope?.dispose();
  menuScope = null;
  contextMenu = buildMenu(readyCtx.client);
  bindMenuOpenClose(contextMenu);
  if (currentTarget && props.visible !== false) {
    attachTo(currentTarget);
  }
}

function bindMenuOpenClose(menu: OverlayHandle) {
  // open/close 只对应 SDK 菜单真正展开/关闭事件，不对应 attach/detach
  const instanceScope = menuScope ?? (menuScope = scope.fork("context-menu-instance"));
  try {
    instanceScope.add(readyCtx!.client.driver.events.on(menu, "open", () => emit("open")));
    instanceScope.add(readyCtx!.client.driver.events.on(menu, "close", () => emit("close")));
  } catch {
    /* 无事件能力的 SDK 忽略 */
  }
}

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = ready;
  // 等待父 overlay 实例就绪(可能晚于 map ready),用 watch 响应变化
  contextMenu = buildMenu(ready.client);
  bindMenuOpenClose(contextMenu);
  let disposeWatch: (() => void) | null = null;
  disposeWatch = watch(
    () => parentOverlay.value,
    (overlay) => {
      if (scope.isDisposed) return;
      const next = overlay ?? (ready.map as SdkHandle<string>);
      attachTo(next);
    },
    { immediate: true, flush: "sync" },
  );
  scope.add(() => disposeWatch?.());

  // visible=false 应从 target 移除或禁用
  scope.add(
    watch(
      () => props.visible,
      (visible) => {
        if (!currentTarget || !contextMenu) return;
        if (visible === false) {
          detach();
        } else {
          attachTo(currentTarget);
        }
      },
    ),
  );

  // menuItems 变化：原子重建
  scope.add(
    watch(
      () => props.menuItems,
      () => rebuildMenu(),
      { deep: true },
    ),
  );
});

onUnmounted(() => {
  detach();
  contextMenu = null;
  currentTarget = null;
  readyCtx = null;
  menuScope?.dispose();
  menuScope = null;
  scope.dispose();
});

defineOptions({ name: "BContextMenu" });
</script>

<template>
  <slot />
</template>
