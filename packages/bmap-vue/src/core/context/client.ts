/**
 * BMapClientContext
 *
 * SDK Client 层的响应式注入上下文。服务类 composable 默认只依赖 Client Context,
 * 无需 Map 即可使用 geocoder/convertor 等能力。
 *
 * M3A3-REMOVE-LEGACY（#26）：`definition` 在这里**直接**交给 `createBMapClient`
 * （后者缺省注入 jsapi-v4 的 Driver 工厂）。迁移期的 `withMigrationDriver` 归一已随
 * webgl-v1 删除，因此同一份 definition 在 `<Map>` / `<BMapProvider>` /
 * `resolveMapContext` / 插件默认 definition 上仍然行为一致，但不再有「宽松 Provider →
 * legacy Driver」这条隐式分派。
 */
import { inject, readonly, shallowRef, type InjectionKey, type ShallowRef } from "vue";
import type { BMapClient, CreateBMapClientOptions } from "../../client/types";
import { createBMapClient } from "../../client/createBMapClient";
import { BMapError } from "../errors/BMapError";

export type ClientStatus = "idle" | "loading" | "ready" | "error" | "disposed";

export interface BMapClientContext {
  readonly status: Readonly<ShallowRef<ClientStatus>>;
  readonly client: Readonly<ShallowRef<BMapClient | null>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
  load(signal?: AbortSignal): Promise<BMapClient>;
  retry(signal?: AbortSignal): Promise<BMapClient>;
  dispose(): void;
}

export const bmapClientContextKey: InjectionKey<BMapClientContext> = Symbol(
  "bmap-client-context",
);

/** app.use() 提供的默认 Client Definition(可被 <BMapProvider> 覆盖) */
export const defaultClientDefinitionKey: InjectionKey<CreateBMapClientOptions | undefined> = Symbol(
  "bmap-default-client-definition",
);

export interface CreateClientContextOptions {
  definition?: CreateBMapClientOptions;
  client?: BMapClient;
}

function toBMapError(err: unknown, fallback: string): BMapError {
  if (err instanceof BMapError) return err;
  return new BMapError("BMAP_SDK_LOAD_FAILED", `${fallback}: ${(err as Error)?.message ?? err}`, {
    cause: err,
  });
}

export function createClientContext(options: CreateClientContextOptions = {}): BMapClientContext {
  const status = shallowRef<ClientStatus>(options.client ? "ready" : "idle");
  const client = shallowRef<BMapClient | null>(options.client ?? null);
  const error = shallowRef<BMapError | null>(null);
  let loadPromise: Promise<BMapClient> | null = null;
  let disposed = false;

  async function doLoad(signal?: AbortSignal): Promise<BMapClient> {
    if (disposed) {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "BMapClientContext has been disposed");
    }
    if (client.value) {
      status.value = "ready";
      return client.value;
    }
    const definition = options.definition;
    if (!definition) {
      throw new BMapError(
        "BMAP_PARENT_CONTEXT_MISSING",
        "No Map client definition. Provide <BMapProvider> or app.use(createBMapPlugin(...)).",
      );
    }
    status.value = "loading";
    error.value = null;
    // 定义直接交给 `createBMapClient`（缺省注入 jsapi-v4 的 Driver 工厂）。
    // 这里是**唯一收口点**——`<Map>` / `<BMapProvider>` / 插件默认 definition /
    // `resolveMapContext` 全部经此创建 Client，因此「同一份 definition 换一个入口就报
    // BMAP_SDK_ENGINE_MISMATCH」不会发生。显式传入的 `driver` 仍然优先。
    const loaded = await createBMapClient(definition, signal);
    if (signal?.aborted) {
      throw toBMapError(
        (signal as AbortSignal).reason,
        "Map client load aborted",
      );
    }
    if (disposed) {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "BMapClientContext disposed during load");
    }
    client.value = loaded;
    status.value = "ready";
    return loaded;
  }

  async function load(signal?: AbortSignal): Promise<BMapClient> {
    if (status.value === "ready" && client.value) return client.value;
    if (status.value === "disposed" || disposed) {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "BMapClientContext has been disposed");
    }
    if (signal?.aborted) {
      return Promise.reject(toBMapError(signal.reason, "Map client load aborted"));
    }
    if (loadPromise) {
      if (!signal) return loadPromise;
      // 带 signal 的调用与共享 promise 竞速,abort 时仅拒绝本次调用
      return Promise.race([
        loadPromise,
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(toBMapError(signal.reason, "wait aborted")), {
            once: true,
          });
        }),
      ]);
    }
    loadPromise = doLoad(signal);
    try {
      return await loadPromise;
    } catch (e) {
      const bmapErr = toBMapError(e, "Map client load failed");
      // abort 不记为 error 状态,保持 idle 以便 retry
      if (signal?.aborted || (e as BMapError)?.code === "BMAP_PROVIDER_ABORTED") {
        if (status.value === "loading") status.value = "idle";
        throw e;
      }
      status.value = "error";
      error.value = bmapErr;
      throw bmapErr;
    } finally {
      loadPromise = null;
    }
  }

  async function retry(signal?: AbortSignal): Promise<BMapClient> {
    if (disposed || status.value === "disposed") {
      throw new BMapError("BMAP_RESOURCE_DISPOSED", "BMapClientContext has been disposed");
    }
    error.value = null;
    if (status.value !== "loading") status.value = "idle";
    return load(signal);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    loadPromise = null;
    client.value = null;
    status.value = "disposed";
  }

  return {
    status: readonly(status),
    client: readonly(client),
    error: readonly(error),
    load,
    retry,
    dispose,
  };
}

export function useOptionalClientContext(): BMapClientContext | undefined {
  return inject(bmapClientContextKey, undefined);
}

export function useRequiredClientContext(): BMapClientContext {
  const ctx = inject(bmapClientContextKey, undefined);
  if (!ctx) {
    throw new BMapError(
      "BMAP_PARENT_CONTEXT_MISSING",
      "Component must be a descendant of <BMapProvider> or <Map>. " +
        "Add <BMapProvider> at the root or call app.use(createBMapPlugin(...)).",
    );
  }
  return ctx;
}
