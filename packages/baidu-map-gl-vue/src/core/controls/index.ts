/**
 * 控件层底座（M7-CONTROL-PANORAMA / issue #41）
 *
 * - `ControlSpec`：控件的声明式描述（选项、创建、挂载、显隐、事件）；
 * - `useControlResource`：执行 spec 的统一 adapter（基于 `useSdkResource`）；
 * - `optionKey` / `changedOptionKeys`：选项变化键与逐键 diff。
 *
 * 控件组件只应经这里与 Driver 的 `controls` Facet 交互，不要各自手写
 * `onMounted` / `onUnmounted` / `addControl` / `removeControl`。
 */
export { useControlResource } from "./useControlResource";
export type { UseControlResourceResult } from "./useControlResource";
export { changedOptionKeys, optionKey } from "./optionKey";
export type {
  ControlBaseProps,
  ControlCreateInput,
  ControlMountInput,
  ControlSpec,
  ControlVisibleInput,
} from "./spec";
