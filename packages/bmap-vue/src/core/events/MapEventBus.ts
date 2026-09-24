/**
 * MapEventBus
 *
 * 每个 MapRuntime 独立实例化的 typed mitt 事件总线。
 * 用于内部松耦合事件(resource:error / overlay:registered / plugin:ready 等),
 * 不用于父子 ready(那由 MapContext 表达)。
 *
 * 规则:
 * - 每次创建 MapRuntime 都新建 emitter。
 * - dispose() 清空全部 listener。
 * - 组件公开事件使用 Vue emits,不经过此总线。
 * - 禁止模块级 singleton。
 */
import mitt, { type Emitter } from "mitt";

export type InternalMapEvents = {
  "resource:error": { error: unknown; component?: string };
  "overlay:registered": { id: symbol; type: string };
  "overlay:disposed": { id: symbol; type: string };
  "plugin:ready": { name: string };
  "plugin:error": { name: string; error: unknown };
};

export type MapEventBus = {
  on: Emitter<InternalMapEvents>["on"];
  off: Emitter<InternalMapEvents>["off"];
  emit: Emitter<InternalMapEvents>["emit"];
  clear: () => void;
};

export function createMapEventBus(): MapEventBus {
  const emitter = mitt<InternalMapEvents>();
  return {
    on: emitter.on,
    off: emitter.off,
    emit: emitter.emit,
    clear: () => emitter.all.clear(),
  };
}
