<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import type { InfoWindowHandle } from "../../driver/types/handles";
import type { BInfoWindowProps } from "../../types/components";

export type { BInfoWindowProps };

const props = withDefaults(defineProps<BInfoWindowProps>(), {
  title: "",
  width: 0,
  height: 0,
  offset: () => ({ x: 0, y: 0 }),
  open: false,
  show: undefined,
  enableMaximize: false,
  enableAutoPan: true,
  enableCloseOnClick: false,
});

const emit = defineEmits<{
  "update:open": [v: boolean];
  "update:show": [v: boolean];
  open: [];
  close: [];
}>();

const ctx = useRequiredMapContext();
const shellRef = useTemplateRef<HTMLElement>("shell");
const infoWindow = shallowRef<InfoWindowHandle | null>(null);
const scope = new ResourceScope();
/**
 * 内容容器是否可见。
 *
 * 气泡的内容节点由组件渲染、交给 SDK 使用（4.0 的 `map.openInfoWindow(infoWnd, point)` 会把
 * 这个节点挂进自己的容器）。**打开时它必须不是 `display:none`**——R25-C / #72 之前模板上写的是
 * 静态 `style="display:none"`，那个内联样式会一直留着，于是「打开」之后内容仍然不可见。
 * 现在改由打开状态驱动：未打开时隐藏（避免内容在地图角落闪现），打开时把可见性交还给 SDK。
 */
const contentVisible = ref(false);
const contentStyle = computed<Record<string, string> | undefined>(() =>
  contentVisible.value ? undefined : { display: "none" },
);
// 内部 open 状态机，避免重复 emit
let lastOpenState: boolean | null = null;
let readyClient: any = null;
let readyMap: any = null;

function isOpenProp(): boolean {
  // show 仅作为 deprecated alias
  return props.show ?? props.open;
}

function emitOpenState(open: boolean) {
  if (lastOpenState === open) return;
  lastOpenState = open;
  emit("update:open", open);
  emit("update:show", open);
  if (open) emit("open");
  else emit("close");
}

/**
 * 打开气泡。
 *
 * **异步就绪保护**：句柄 / client / map 三者缺一就什么都不做——它们在 `onMounted` 的
 * `whenReady()` 之后才有值，而卸载路径（`onUnmounted` 已把 `infoWindow` 置空）之后挂在 scope
 * 上的 watcher 仍可能被触发。这里显式前置校验，而不是让 `undefined.driver` 抛进 Vue 的错误处理器。
 *
 * **`position` 是打开气泡的必需契约**（R25-C 复审 P1）：官方 4.0 的
 * `Map#openInfoWindow(infoWnd, point)` 要求位置，`InfoWindow` 实例没有公开的 `openInfoWindow()`，
 * 所以「没有位置」没有可解释的语义。缺位置时把错误交到统一的事件通道（`resource:error`），
 * 而不是依赖 Driver 的运行时回退「碰巧打开」。气泡挂到 Marker 的目标级打开属 M5 #31/#32。
 */
function openWindow(): void {
  const iw = infoWindow.value;
  if (!iw || !readyClient || !readyMap) return;
  const position = props.position;
  if (!position) {
    try {
      ctx.events.emit("resource:error", {
        error: new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "<BInfoWindow>: 打开气泡必须给出 position——官方 4.0 的 map.openInfoWindow(infoWnd, point) " +
            "里 point 是必需参数（气泡挂到 Marker 的目标级打开属 M5 #31/#32）",
        ),
        component: "BInfoWindow",
      });
    } catch {
      /* 事件总线已停用时不再追究 */
    }
    return;
  }
  readyClient.driver.overlays.openInfoWindow(readyMap, iw, position);
  contentVisible.value = true;
  emitOpenState(true);
}

function closeWindow(): void {
  const iw = infoWindow.value;
  if (!iw || !readyClient) return;
  try {
    // 关闭走**地图级**专用入口（v4：`map.closeInfoWindow()`；legacy：实例的 `hide()`），
    // 不再用通用的 removeOverlay——气泡不是普通覆盖物。
    readyClient.driver.overlays.closeInfoWindow(iw);
  } catch {
    /* 忽略关闭错误：气泡可能已被别的实例顶掉 */
  }
  contentVisible.value = false;
  emitOpenState(false);
}

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyClient = ready.client;
  readyMap = ready.map;

  const iw = readyClient.driver.overlays.createInfoWindow(
    shellRef.value ?? document.createElement("div"),
    {
      width: props.width,
      height: props.height,
      title: props.title,
      enableMaximize: props.enableMaximize,
      enableAutoPan: props.enableAutoPan,
      enableCloseOnClick: props.enableCloseOnClick,
      offset: props.offset,
    },
  );
  infoWindow.value = iw;
  lastOpenState = false;

  // SDK close/open 事件 → 仅状态真实变化时回写一次
  scope.add(
    readyClient.driver.events.on(iw, "close", () => {
      contentVisible.value = false;
      emitOpenState(false);
    }),
  );
  scope.add(
    readyClient.driver.events.on(iw, "open", () => {
      contentVisible.value = true;
      emitOpenState(true);
    }),
  );

  // slot 内容变化 → redraw；Observer 纳入 scope，释放时 disconnect
  if (shellRef.value && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      try {
        readyClient.driver.overlays.redrawInfoWindow(iw);
      } catch {
        /* 忽略 */
      }
    });
    observer.observe(shellRef.value, { childList: true, subtree: true, characterData: true });
    scope.observe(observer);
  }

  // open state → SDK(状态机:prop 驱动)
  scope.add(
    watch(
      () => isOpenProp(),
      (open) => {
        if (open) {
          if (lastOpenState === true) return;
          openWindow();
        } else {
          if (lastOpenState === false) return;
          closeWindow();
        }
      },
      { immediate: true },
    ),
  );

  // 动态 props 同步
  scope.add(
    watch(
      () => props.title,
      (title) => {
        if (title == null) return;
        try {
          readyClient.driver.overlays.setOptions(iw, { title });
          readyClient.driver.overlays.redrawInfoWindow(iw);
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
  scope.add(
    watch(
      () => props.width,
      (w) => {
        if (w == null) return;
        try {
          readyClient.driver.overlays.setOptions(iw, { width: w });
          readyClient.driver.overlays.redrawInfoWindow(iw);
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
  scope.add(
    watch(
      () => props.height,
      (h) => {
        if (h == null) return;
        try {
          readyClient.driver.overlays.setOptions(iw, { height: h });
          readyClient.driver.overlays.redrawInfoWindow(iw);
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
  scope.add(
    watch(
      [() => props.position?.lng, () => props.position?.lat],
      ([lng, lat], [oldLng, oldLat]) => {
        if (lng == null || lat == null) return;
        if (lng === oldLng && lat === oldLat) return;
        try {
          readyClient.driver.overlays.setOptions(iw, { position: { lng, lat } });
          // 已打开时跟随移动（`openInfoWindow` 是唯一的「带位置打开」入口）
          if (lastOpenState) openWindow();
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
});

onUnmounted(() => {
  // 卸载时先关气泡，再释放 scope（事件订阅 / watcher / Observer）。
  // 气泡**不**走 `overlays.remove()`：R25-C / #72 之前那一步在 v4 上必抛
  // `BMAP_INVALID_ARGUMENT`（气泡不是普通覆盖物），而 close 已经把地图级状态清干净。
  try {
    if (infoWindow.value && readyClient) {
      readyClient.driver.overlays.closeInfoWindow(infoWindow.value);
    }
  } catch {
    /* 忽略 */
  }
  infoWindow.value = null;
  readyClient = null;
  readyMap = null;
  contentVisible.value = false;
  scope.dispose();
});
</script>

<template>
  <div ref="shell" :style="contentStyle" v-bind="$attrs">
    <slot />
  </div>
</template>
