/**
 * Vue 组件更新计数（issue #140 官方对照基准共用）
 *
 * ## 为什么是这一个文件，而不是基准文件里的一段代码
 *
 * `@vue/runtime-dom` 的渲染器在**模块体求值**时就把 `target.__VUE_DEVTOOLS_GLOBAL_HOOK__`
 * 读进模块级变量 `devtools`（`runtime-core` 的 `baseCreateRenderer` → `setDevtoolsHook$1`），
 * 之后**再也不会**重新读全局。也就是说：在 `beforeAll` / 测试体里装钩子**太晚了**——
 * 渲染器早就建好，`devtools` 已经是 `undefined`，`component:updated` 会被塞进内部 buffer
 * 而不是我们的钩子，读数恒为 0（实测踩过）。
 *
 * 因此钩子必须在 **Vue 被 import 之前**装好。ESM 的 import 求值顺序是**源码书写顺序**，
 * 所以基准的装配模块 `import "./vueRenderCounter.ts"` 必须写在 `import ... from "vue"` **之前**；
 * 而本文件**不能**有运行期的 `vue` 导入（类型导入会被擦除，安全），否则顺序就又反过来了。
 *
 * ## 数的是哪一个事件：`perf:start`（`type === "render"`），不是 `component:updated`
 *
 * Vue 3 去掉了 Vue 2 的 `app.on("app:renderTriggered")`，公开观测口只剩 devtools 全局钩子。
 * 这里选 `perf:start` 而不是 `component:updated`，理由是**覆盖面**：
 *
 * - `component:updated` 只在**更新**时 emit（`runtime-core` 的 `devtoolsComponentUpdated`
 *   在 `componentUpdateFn` 的 `else` 分支里调用），**首次挂载不计数**。而票面一半的场景
 *   （1/2/8/9/10）量的是挂载与卸载——那些动作里组件根本没有「更新」过，按 `component:updated`
 *   数会恒读 0。
 * - `perf:start` 由 `startMeasure(instance, "render")` 触发，**首次挂载与每次更新都过**，
 *   且那对调用**不在** `app.config.performance` 判断里（只有配套的 `perf.mark` 在），所以默认
 *   关闭的 Vue 性能开关不会把它关掉。
 *
 * 只认 `type === "render"`：同一对钩子还会发 `patch` / `hydrate`，那些不是一次「重渲染」。
 *
 * ⚠️ 它数的是「组件渲染次数」，**不是**「SDK 调用次数」：一次渲染里可能有 0 次、也可能有
 * 多次 SDK 写入。票面把两者都列为指标，所以报告里是两列而不是一列。
 *
 * ⚠️ 钩子是**进程级单例**（后装的覆盖先装的），所以这里装一次、内部按根实例分流。
 */
import type { ComponentInternalInstance } from "vue";

/** 按根实例归属的**组件渲染**计数桶。 */
export interface RenderBucket {
  count: number;
}

const renderBuckets = new WeakMap<object, RenderBucket>();

function rootInstanceOf(instance: unknown): ComponentInternalInstance | null {
  let current = instance as ComponentInternalInstance | null;
  while (current?.parent) current = current.parent;
  return current;
}

/**
 * 装上 devtools 全局钩子。
 *
 * 必须是**整个进程里第一个碰 Vue 的东西**（见文件头第 1 节）。幂等：重复调用只是重装
 * 同一个形状的钩子，桶（WeakMap）不受影响。
 *
 * ⚠️ `emit(event, ...args)` 的**下标**由 Vue 的 `createDevtoolsPerformanceHook` 决定
 * （`runtime-core` 源码）：
 *
 * ```js
 * function createDevtoolsPerformanceHook(hook) {
 *   return (component, type, time) =>
 *     emit$1(hook, component.appContext.app, component.uid, component, type, time);
 * }
 * ```
 *
 * 即 `args = [app, uid, instance, type, time]`——**组件实例是 `args[2]`，不是 `args[0]`**
 * （`args[0]` 是 app 对象）。挂载时桶尚未建立，见 `bucketFor` 的说明。
 */
export function installRenderCounter(): void {
  (globalThis as Record<string, unknown>).__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
    enabled: true,
    emit(event: string, ...args: unknown[]) {
      if (event !== "perf:start") return;
      if (args[3] !== "render") return;
      const root = rootInstanceOf(args[2]);
      const bucket = root ? renderBuckets.get(root) : undefined;
      if (bucket) bucket.count += 1;
    },
    on: () => {},
    cleanupBuffer: () => true,
  };
}

/**
 * 取（并首次建立）某个根实例的计数桶。根为 `null` 时返回**一次性**空桶，读数恒为 0。
 *
 * ⚠️ 必须在**根组件自己的 `setup()` 里**调用，不能在 `mount()` / `app.mount()` 返回之后调。
 * 挂载型场景（本档场景 1/2）把整棵树的建立放进动作窗口，`mount()` 返回时那批
 * `perf:start` **早就发完了**——事后建桶会永远读到 0（实测踩过：官方侧因为要等 ready、
 * 注册发生在动作之前，两侧读数一边 0 一边 103）。
 * 根组件的 `setup()` 早于它自己的第一次渲染，是最早能拿到实例、且不漏计的点。
 */
export function bucketFor(root: ComponentInternalInstance | null): RenderBucket {
  if (!root) return { count: 0 };
  let bucket = renderBuckets.get(root);
  if (!bucket) {
    bucket = { count: 0 };
    renderBuckets.set(root, bucket);
  }
  return bucket;
}

/** 取某个实例所属的（自顶向下第一个）根实例对应的计数桶。 */
export function bucketForInstance(instance: ComponentInternalInstance | null): RenderBucket {
  return bucketFor(rootInstanceOf(instance));
}

// ⚠️ 安装放在**模块体**而不是让基准在 `beforeAll` 调：ESM 先求值全部 import、再跑本模块体。
// 若安装发生在 `beforeAll`，那时 `vue` 早已求值完、`devtools` 已固定为 `undefined`，
// 事件只会进 Vue 内部 buffer（实测读数恒为 0）。「本模块排在 `vue` 之前被 import」+
// 「模块体自安装」是钩子赶在渲染器创建前生效的唯一组合。
installRenderCounter();
