/**
 * useSdkResource —— 统一 SDK 资源生命周期
 *
 * 替代行为各异的 useMapResource/useOverlayResource/useControlResource/useLayerResource
 * 的底层统一实现。外层保留薄封装,底层统一:
 * - context 就绪前卸载:不创建
 * - 创建后探测已卸载:立即销毁
 * - sequence token 防旧 Promise 覆盖新实例
 * - 每次 replace/rebuild 销毁旧 child scope
 * - 不在返回时创建无人处理的 rejected ready Promise,改提供 whenReady() 函数
 */
import {
  onMounted,
  onScopeDispose,
  readonly,
  shallowRef,
  type ShallowRef,
} from "vue";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { BMapError } from "../errors/BMapError";
import type { ResourceRegistration } from "../overlays/OverlayRegistry";

export type SdkResourceStatus =
  | "idle"
  | "creating"
  | "ready"
  | "error"
  | "disposing"
  | "disposed";

export interface SdkResourceSpec<Props, Resource, Context> {
  readonly type: string;
  create(input: {
    context: Context;
    props: Readonly<Props>;
    scope: ResourceScope;
  }): Resource | Promise<Resource>;
  mount(input: {
    context: Context;
    resource: Resource;
    props: Readonly<Props>;
    scope: ResourceScope;
    /**
     * 本次挂载属于**过期一代的清理路径**（`create()` 结算时发现已被卸载 / 取代）。
     *
     * 这条路径上的 `mount` 只用于拿到 registration 再立刻 `dispose()`（让 SDK 侧把刚建出来的
     * 实例摘掉），因此 spec 在里面**不得执行组件侧副作用**——那是对一个马上消失的实例做业务动作，
     * 而且回滚不了（PR #103 评审 1：`GroundOverlay.afterMount` 的 `setViewport` 会改地图视野）。
     */
    stale?: boolean;
  }): ResourceRegistration<Resource> | void;
  bind?(input: {
    context: Context;
    resource: Resource;
    props: Readonly<Props>;
    scope: ResourceScope;
  }): void;
  watch?(input: {
    context: () => Context | null;
    resource: () => Resource | null;
    props: Readonly<Props>;
    replace: () => Promise<void>;
    scope: ResourceScope;
  }): void;
}

export interface UseSdkResourceResult<Resource> {
  readonly resource: Readonly<ShallowRef<Resource | null>>;
  readonly status: Readonly<ShallowRef<SdkResourceStatus>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
  replace: () => Promise<void>;
  dispose: () => void;
  whenReady: () => Promise<Resource>;
}

export interface UseSdkResourceOptions<Props, Resource, Context> {
  props: Readonly<Props>;
  spec: SdkResourceSpec<Props, Resource, Context>;
  resolveContext: (signal: AbortSignal) => Promise<Context>;
  onError?: (error: BMapError) => void;
  label?: string;
}

export function useSdkResource<Props, Resource, Context>(
  options: UseSdkResourceOptions<Props, Resource, Context>,
): UseSdkResourceResult<Resource> {
  const { props, spec, resolveContext, onError, label } = options;
  const componentScope = new ResourceScope({ label: label ?? `sdk-resource:${spec.type}` });
  let instanceScope: ResourceScope | null = null;
  let registration: ResourceRegistration<Resource> | null = null;

  const resource = shallowRef<Resource | null>(null);
  const status = shallowRef<SdkResourceStatus>("idle");
  const error = shallowRef<BMapError | null>(null);

  let readyCtx: Context | null = null;
  let disposed = false;
  let createToken = 0;
  // whenReady 等待者:状态可回放,不预创建 rejected promise
  let readyWaiters: Array<{ resolve: (r: Resource) => void; reject: (e: unknown) => void }> = [];

  const getContext = () => readyCtx;
  const getResource = () => resource.value;

  function settleReady(err?: unknown) {
    if (resource.value && !err) {
      const r = resource.value;
      const ws = readyWaiters;
      readyWaiters = [];
      for (const w of ws) w.resolve(r);
    } else if (err) {
      const ws = readyWaiters;
      readyWaiters = [];
      for (const w of ws) w.reject(err);
    }
  }

  // setup 同步注册 watch(保证响应式),存活于 componentScope
  try {
    spec.watch?.({
      context: getContext,
      resource: getResource,
      props,
      replace,
      scope: componentScope,
    });
  } catch (e) {
    error.value = e instanceof BMapError ? e : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(e), { cause: e });
    status.value = "error";
  }

  function disposeInstance() {
    try {
      registration?.dispose();
    } catch {
      /* 忽略 teardown 错误 */
    }
    registration = null;
    try {
      instanceScope?.dispose("sdk-resource-replaced");
    } catch {
      /* ignore */
    }
    instanceScope = null;
  }

  async function createOnce(context: Context, token: number): Promise<void> {
    // 每次创建使用全新 child scope;旧 scope 已在调用方销毁
    const scope = componentScope.fork(`${spec.type}-instance`);
    instanceScope = scope;
    status.value = "creating";
    try {
      const created = await spec.create({ context, props, scope });
      if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
        // 竞态:已卸载或被新一代取代,立即清理新建实例
        try {
          const tmpReg = spec.mount({ context, resource: created, props, scope, stale: true });
          tmpReg instanceof Object && (tmpReg as ResourceRegistration<Resource>)?.dispose?.();
        } catch {
          /* ignore */
        }
        try {
          scope.dispose("stale-generation");
        } catch {
          /* ignore */
        }
        if (instanceScope === scope) instanceScope = null;
        return;
      }
      const reg = spec.mount({ context, resource: created, props, scope });
      if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
        try {
          (reg as ResourceRegistration<Resource> | void) instanceof Object &&
            (reg as ResourceRegistration<Resource>)?.dispose?.();
        } catch {
          /* ignore */
        }
        try {
          scope.dispose("stale-generation");
        } catch {
          /* ignore */
        }
        if (instanceScope === scope) instanceScope = null;
        return;
      }
      registration = (reg as ResourceRegistration<Resource> | void) as ResourceRegistration<Resource> | null;
      // mount 未返回 registration 时包装为轻量 registration(仅摘除 scope)
      if (registration && typeof (registration as ResourceRegistration<Resource>).dispose !== "function") {
        registration = null;
      }
      resource.value = created;
      status.value = "ready";
      error.value = null;
      try {
        spec.bind?.({ context, resource: created, props, scope });
      } catch (e) {
        const bmapErr =
          e instanceof BMapError
            ? e
            : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(e), { cause: e });
        onError?.(bmapErr);
      }
      settleReady();
    } catch (e) {
      if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
        try {
          scope.dispose("failed-stale");
        } catch {
          /* ignore */
        }
        if (instanceScope === scope) instanceScope = null;
        return;
      }
      const bmapErr =
        e instanceof BMapError
          ? e
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(e), { cause: e });
      // abort 不记 error
      if (componentScope.signal.aborted) return;
      status.value = "error";
      error.value = bmapErr;
      onError?.(bmapErr);
      settleReady(bmapErr);
      try {
        scope.dispose("failed");
      } catch {
        /* ignore */
      }
      if (instanceScope === scope) instanceScope = null;
    }
  }

  async function replace(): Promise<void> {
    if (disposed || componentScope.isDisposed) return;
    const token = ++createToken;
    // 原子:先摘除旧实例再创建新实例,不可同时挂载
    disposeInstance();
    resource.value = null;
    if (!readyCtx) {
      try {
        readyCtx = await resolveContext(componentScope.signal);
      } catch {
        return;
      }
      if (disposed || token !== createToken) return;
    }
    await createOnce(readyCtx, token);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    createToken++;
    status.value = "disposing";
    disposeInstance();
    resource.value = null;
    readyCtx = null;
    const ws = readyWaiters;
    readyWaiters = [];
    const err = new BMapError("BMAP_RESOURCE_DISPOSED", `${spec.type} disposed`);
    for (const w of ws) w.reject(err);
    status.value = "disposed";
    try {
      componentScope.dispose("sdk-resource-disposed");
    } catch {
      /* ignore */
    }
  }

  function whenReady(): Promise<Resource> {
    if (resource.value && status.value === "ready") return Promise.resolve(resource.value);
    if (status.value === "error" && error.value) return Promise.reject(error.value);
    if (disposed) return Promise.reject(new BMapError("BMAP_RESOURCE_DISPOSED", `${spec.type} disposed`));
    return new Promise<Resource>((resolve, reject) => {
      readyWaiters.push({ resolve, reject });
    });
  }

  onMounted(async () => {
    const token = ++createToken;
    try {
      const ctx = await resolveContext(componentScope.signal);
      if (componentScope.isDisposed || disposed || token !== createToken) return;
      readyCtx = ctx;
      await createOnce(ctx, token);
    } catch (e) {
      if (componentScope.signal.aborted || disposed || token !== createToken) return;
      const bmapErr =
        e instanceof BMapError
          ? e
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(e), { cause: e });
      status.value = "error";
      error.value = bmapErr;
      onError?.(bmapErr);
      settleReady(bmapErr);
    }
  });

  onScopeDispose(() => dispose());

  return {
    resource: resource as Readonly<ShallowRef<Resource | null>>,
    status: status as Readonly<ShallowRef<SdkResourceStatus>>,
    error: error as Readonly<ShallowRef<BMapError | null>>,
    replace,
    dispose,
    whenReady,
  };
}
