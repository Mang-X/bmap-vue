<script setup lang="ts">
import { markRaw, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import type { MapReadyContext } from "../../core/context/types";
import type { ServiceHandle } from "../../driver/types/handles";

/**
 * BAutoComplete 迁移
 *
 * Autocomplete 需要绑定真实 input DOM(not overlay/control)。
 * 使用 map context + ready 后创建 SDK 实例,并把 input 传给 SDK。
 *
 * R25-C / #72 修复的三处（此前是本组件最容易漏清理的地方）：
 *
 * 1. **watcher 纳入作用域**：`onMounted` 是 async 的，`await whenReady()` 之后的 `watch()`
 *    不在 Vue 的实例作用域里（`getCurrentInstance()` 为 null），不注册进 `ResourceScope`
 *    就会在卸载后继续存活，并回写已经销毁的实例；
 * 2. **调用 Driver 的公开释放入口**：卸载时 `disposeAutocomplete()`——Driver 挂在输入框上的
 *    输入活动监听必须随实例一起下线（输入框通常比实例活得久）；
 * 3. **raw setter 回到集成边界**：`location` / `types` 的同步走
 *    `driver.services.setAutocompleteOptions()`，组件不再直接访问 `instance.raw.setLocation`。
 */
export interface BAutoCompleteProps {
  location?: string | { lng: number; lat: number } | unknown;
  types?: string[];
  onSearchComplete?: (e: unknown) => void;
  onHighlight?: (e: unknown) => void;
  onConfirm?: (e: unknown) => void;
}

const props = withDefaults(defineProps<BAutoCompleteProps>(), {});

const emit = defineEmits<{
  searchComplete: [e: unknown];
  highlight: [e: unknown];
  confirm: [e: unknown];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

const resource = shallowRef<ServiceHandle<"service:autocomplete"> | null>(null);
const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let readyCtx: MapReadyContext | null = null;
let disposed = false;

/** 把清理/更新失败交给统一的事件通道，而不是在卸载路径里抛异常。 */
function reportResourceError(code: "BMAP_SDK_CALL_FAILED" | "BMAP_RESOURCE_UPDATE_FAILED", error: unknown): void {
  try {
    ctx.events.emit("resource:error", {
      error:
        error instanceof BMapError ? error : new BMapError(code, String(error), { cause: error }),
      component: "BAutoComplete",
    });
  } catch {
    /* 事件总线已停用时不再追究 */
  }
}

/**
 * Driver 侧的释放入口**只在 v4 Driver 上存在**（`JsapiV4ServiceDriver.disposeAutocomplete`）：
 * legacy 的 Autocomplete 没有 Driver 侧资源（输入活动监听、待回包队列都是 v4 Facet 的记账）。
 * 组件不按引擎分支，因此按**结构化能力**探测：有就用，没有就退化为「只解绑本组件持有的订阅」
 * （后者由 `ResourceScope` 负责）。#26 删除 webgl-v1 后这个探测可以收成直接调用。
 */
function disposeService(instance: ServiceHandle<"service:autocomplete">): void {
  const services = readyCtx?.client?.driver?.services as
    | { disposeAutocomplete?: (handle: ServiceHandle<"service:autocomplete">) => void }
    | undefined;
  if (typeof services?.disposeAutocomplete !== "function") return;
  try {
    services.disposeAutocomplete(instance);
  } catch (error) {
    // SDK dispose 抛错时句柄已停用、清理可以重试（见 `disposeAutocomplete` 的契约）；
    // 卸载路径不能因此抛异常，但要把它交出去而不是静默吞掉。
    reportResourceError("BMAP_SDK_CALL_FAILED", error);
  }
}

/**
 * 同步 `location` / `types` 到已创建的实例。
 *
 * `location` 直接传领域值或句柄（`ready.map` 是 `MapHandle`）——归一化在 Driver 里做：
 * 官方 `AutocompleteOptions.location` 只接受 `string | Map | Point`，把本库句柄透传给 SDK
 * 是非法值。
 */
function updateOptions(
  instance: ServiceHandle<"service:autocomplete">,
  options: { location?: unknown; types?: string[] },
): void {
  const services = readyCtx?.client?.driver?.services;
  if (!services) return;
  try {
    services.setAutocompleteOptions(instance, options);
  } catch (error) {
    reportResourceError("BMAP_RESOURCE_UPDATE_FAILED", error);
  }
}

onMounted(async () => {
  try {
    const ready = await ctx.whenReady(scope.signal);
    if (scope.isDisposed || disposed) return;
    readyCtx = ready;
    const input = inputRef.value;
    if (!input) return;
    const instance = ready.client.driver.services.createAutocomplete({
      location: props.location ?? ready.map,
      input,
      types: props.types,
      onSearchComplete: (e: unknown) => emit("searchComplete", e),
    });
    resource.value = markRaw(instance as object) as ServiceHandle<"service:autocomplete">;
    // 先登记**释放**：`ResourceScope.dispose()` 按注册逆序执行，于是业务订阅先下线、
    // 再由 Driver 释放实例（与「先解绑业务事件、再移除资源」的既有口径一致）。
    scope.add(() => disposeService(instance));
    // bind highlight / confirm
    scope.add(ready.client.driver.events.on(instance, "highlight", (e) => emit("highlight", e)));
    scope.add(ready.client.driver.events.on(instance, "confirm", (e) => emit("confirm", e)));

    scope.add(
      watch(
        () => props.location,
        (loc) => {
          if (loc === undefined) return;
          updateOptions(instance, { location: loc });
        },
      ),
    );
    scope.add(
      watch(
        () => props.types,
        (types) => {
          if (!types) return;
          updateOptions(instance, { types: [...types] });
        },
      ),
    );
    // 挂到 scope,卸载自动释放
    scope.add(() => {
      resource.value = null;
    });
  } catch (error) {
    if (!scope.signal.aborted && !disposed) {
      ctx.events.emit("resource:error", {
        error:
          error instanceof BMapError
            ? error
            : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error }),
        component: "BAutoComplete",
      });
    }
  }
});

onUnmounted(() => {
  disposed = true;
  scope.dispose();
});

defineOptions({ name: "BAutoComplete" });
</script>

<template>
  <input class="b-auto-complete-input" type="text" ref="inputRef" placeholder="请输入搜索关键词" />
</template>

<style scoped>
.b-auto-complete-input {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  box-sizing: border-box;
  width: 100%;
  max-width: calc(100% - 20px);
  padding: 6px 10px;
  color: #333;
  background-color: #fff;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  outline: none;
}

.b-auto-complete-input:focus {
  border-color: #1677ff;
}
</style>
