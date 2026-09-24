/**
 * 声明式菜单项的注册表（M5-CUSTOM-MENU / issue #33）
 *
 * `<MenuItem>` / `<MenuSeparator>` 不渲染任何有意义的 DOM，它们只把「这里有一条菜单项」告诉父级
 * `<ContextMenu>`。这条交接走 provide/inject：父级 provide 一个注册表，子组件在 `setup` 期
 * 登记自己，卸载时销账。
 *
 * ## 顺序从哪来（这是本文件唯一需要解释的设计）
 *
 * 菜单项的**顺序**由「当前渲染顺序」决定，而不是「注册顺序」。两者在静态列表下相同，但在
 * `v-if` 之下会分叉：一个被隐藏又再次显示的项会**重新挂载**，注册顺序会把它排到末尾，而渲染
 * 顺序仍然把它放回原来的位置——后者与作者在模板里写的顺序一致，也是唯一合理的期望。
 *
 * 取渲染顺序的做法：每个子组件渲染一个**占位元素**（属性值 = 它的登记键），父级在解析时读
 * **占位元素在宿主里的先后**。宿主是一个 detached `<div>`（永不在文档里），因此这些占位元素对
 * 使用者不可见，也不进地图容器的 DOM。
 *
 * 为什么不用「遍历 vnode 树」：那要求父级在**子组件 setup 之前**拿到本轮渲染的 vnode 并按下标建立
 * 映射，而 `<script setup>` 的模板渲染不在父级的控制流里；占位元素方案只依赖「DOM 顺序 = 渲染
 * 顺序」这一条 Vue 的稳定事实（patch 按 vnode 顺序插入），实现与验证都更直接。
 *
 * ## 为什么存**读取器**而不是值快照
 *
 * 子组件的 props 会变（`<MenuItem :text="dynamic" />`）。存快照就必须再配一条「同步快照」的路径，
 * 而那条路径迟早会漏字段。存读取器时父级每次解析都拿到最新 props，**没有第二份副本**；
 * 子组件只需要在值变化时 `invalidate()` 提醒父级重新解析（父级用指纹决定要不要真的重建菜单）。
 *
 * 顺序解析必须发生在**子树的 patch 结束之后**，因此父级是在 `nextTick` 后读取的
 * （见 `useContextMenu`）——注册回调只负责「通知有变化」。
 */
import { inject, type InjectionKey } from "vue";
import type { ContextMenuSelectPayload } from "../../types/components";

/** 一条声明式菜单项。`"-"` 表示分隔线（与数据 API 的写法一致）。 */
export type ContextMenuDeclaration = ContextMenuDeclarationItem | "-";

export interface ContextMenuDeclarationItem {
  /** 菜单项文字。 */
  readonly text: string;
  /** 是否禁用。 */
  readonly disabled?: boolean;
  /** 该项宽度（官方 `MenuItemOptions.width`）。 */
  readonly width?: number;
  /** 该项 DOM 的 id（官方 `MenuItemOptions.id`）。 */
  readonly id?: string;
  /**
   * 选中时的回调。
   *
   * 与数据 API 的 `ContextMenuItem.callback` 归一化到同一处（父级调用它 ⇒ 两种写法行为一致）；
   * `<MenuItem>` 在自己的这个回调里派发 `@select`。
   */
  readonly onSelect?: (payload: ContextMenuSelectPayload) => void;
}

/** 登记凭据。`key` 同时是占位元素的属性值；`dispose()` / `invalidate()` 都幂等。 */
export interface ContextMenuDeclarationHandle {
  /** 占位元素上写的键（父级据此把 DOM 顺序还原成声明顺序）。 */
  readonly key: string;
  /** 本条声明的**值**变了（props 改了）：请父级重新解析并（按指纹）决定是否重建菜单。 */
  invalidate(): void;
  /** 从注册表移除（幂等）。 */
  dispose(): void;
}

export interface ContextMenuChildrenRegistry {
  /**
   * 占位元素上承载登记键的属性名。
   *
   * 由**注册表自己**给出而不是子组件手写字符串：子组件写属性、父级读属性，两侧必须逐字一致，
   * 而这正是「两处各写一遍就一定漂移」的典型。
   */
  readonly keyAttribute: string;
  /**
   * 登记一条菜单项 / 分隔线。
   *
   * 入参是**读取器**（见文件头）：父级每次解析都拿最新的 props 值，不存第二份副本。
   */
  declare(read: () => ContextMenuDeclaration): ContextMenuDeclarationHandle;
  /** 按登记键读回当前声明（键不存在时为 `undefined`）。 */
  lookup(key: string): ContextMenuDeclaration | undefined;
  /** 订阅「声明集合或某条声明的值发生变化」。返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

/** 父级 provide、子组件 inject 的键。 */
export const contextMenuChildrenKey: InjectionKey<ContextMenuChildrenRegistry> = Symbol(
  "bmap-context-menu-children",
);

export function createContextMenuChildrenRegistry(): ContextMenuChildrenRegistry {
  let sequence = 0;
  const readers = new Map<string, () => ContextMenuDeclaration>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    // 复制一份再遍历：监听器内部退订不影响本轮
    for (const listener of [...listeners]) listener();
  };

  return {
    keyAttribute: "data-bmap-menu-key",
    declare(read) {
      const key = `menu-${++sequence}`;
      readers.set(key, read);
      notify();
      let disposed = false;
      return {
        key,
        invalidate: notify,
        dispose() {
          if (disposed) return;
          disposed = true;
          readers.delete(key);
          notify();
        },
      };
    },
    lookup(key) {
      const read = readers.get(key);
      return read ? read() : undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * 子组件拿到的「我属于哪个菜单」。
 *
 * 返回 `undefined` 表示**没有父级菜单**（`<MenuItem>` 被放错地方了）：调用方应当告警一次并什么
 * 都不渲染——把「放错位置」静默变成一个永远不出现的菜单项，是本库明确要避免的假支持。
 */
export function useOptionalContextMenuChildren(): ContextMenuChildrenRegistry | undefined {
  return inject(contextMenuChildrenKey, undefined);
}
