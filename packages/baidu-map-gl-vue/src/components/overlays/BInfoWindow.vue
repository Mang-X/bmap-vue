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

/** 缺位置时的统一报错出口（走组件既有的 `resource:error` 诊断通道）。 */
function reportMissingPosition(): void {
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
}

/** 在给定位置打开（或移动）气泡。`position` 已由调用方校验过。 */
function openWindowAt(position: { lng: number; lat: number }): void {
  const iw = infoWindow.value;
  if (!iw || !readyClient || !readyMap) return;
  readyClient.driver.overlays.openInfoWindow(readyMap, iw, position);
  contentVisible.value = true;
  emitOpenState(true);
}

/**
 * 把**期望状态**同步到 SDK。
 *
 * 声明式口径（一条规则，没有隐藏状态）：
 * `open === true` **且** `position` 有效 ⇒ 打开；任一不满足 ⇒ 不打开（已经开着就关掉；
 * 是「想开但缺位置」时额外报一次 `BMAP_INVALID_ARGUMENT`）。
 *
 * 为什么按「期望状态」而不是「上一次的实际状态」判断（R25-C 复审第 2 轮 P1）：`position` 通常是
 * 异步拿到的，`open=true` 会先于它到达。若按上一次实际状态判断，那一次失败之后 position 到了也不会
 * 重试，气泡会一直关着，用户只能手动把 `open` 切成 `false → true` 才能恢复 —— 这不是受控组件该有的
 * 语义。
 *
 * **`position` 不写进实例 option**（同轮 P2）：它在覆盖物元数据里是 `unsupported`（气泡位置由
 * `openInfoWindow(map, iw, position)` 提供），先 `setOptions()` 会打印一条「position 在当前引擎
 * 不支持，本次更新被忽略」的误导日志，紧接着又靠 `openInfoWindow` 真正移动。位置不进实例状态：
 * 重新走一次 `openInfoWindow` 即可（它同时负责「打开」与「移动」）。
 *
 * **异步就绪保护**：句柄 / client / map 三者缺一就什么都不做——它们在 `onMounted` 的
 * `whenReady()` 之后才有值，而卸载路径之后挂在 scope 上的 watcher 仍可能被触发。
 */
function applyOpenIntent(): void {
  if (!infoWindow.value || !readyClient || !readyMap) return;
  const position = props.position;
  const wantOpen = isOpenProp() && !!position;

  if (!wantOpen) {
    if (lastOpenState === true) closeWindow();
    if (isOpenProp() && !position) reportMissingPosition();
    return;
  }
  openWindowAt(position);
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

  // open / position → 期望状态同步（两个 watcher 走同一份判定，避免两条路径各有一套规则）
  scope.add(watch(() => isOpenProp(), () => applyOpenIntent(), { immediate: true }));

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
        // 只在坐标**真的变了**（含变成 undefined）时同步；`position` 的移动与「打开」都由
        // `applyOpenIntent()` 走 `openInfoWindow`，不进实例 option（见该函数的注释）
        if (lng === oldLng && lat === oldLat) return;
        applyOpenIntent();
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
