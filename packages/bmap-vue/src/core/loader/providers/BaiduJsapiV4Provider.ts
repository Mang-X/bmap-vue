/**
 * BaiduJsapiV4Provider —— 默认在线路径（JSAPI 4.0）
 *
 * R25-B（issue #71）之后，本 Provider **不再自己加载 script**：默认在线加载的唯一实现是
 * 官方 `@baidumap/jsapi-loader`（精确锁定 `1.0.0`，契约见
 * `docs/zh-CN/contributing/official-packages.md`），本文件只负责官方契约与本库领域契约之间的
 * 那一段：
 *
 * 1. **配置口径**：把 `BMapLoadOptions` 映射成官方选项；上游没有入口的配置显式报错，
 *    而不是接收后忽略（见 `./official`）；
 * 2. **配置冲突**：与 Custom / ExistingGlobal 共享进程级 `BMap` 冲突域（`SdkRegistry`），
 *    同指纹复用同一任务、不同 AK 报结构化冲突；
 * 3. **调用方取消等待**：每个消费者各持 `AbortSignal`，取消只结算自己，不影响同任务上的
 *    其它消费者；
 * 4. **LoadedJsapiV4 归一化**：官方 resolve 出来的东西必须**真的是可用的 v4 命名空间**才算成功，
 *    然后组装成 `LoadedJsapiV4`（含脱敏 metadata）。
 *
 * 刻意**不**做的事（都属于官方 Loader 自有语义，重复一份就是两套状态机）：
 * 拼入口 URL、管 script 单例、挂 / 收 JSONP 回调、判超时、判上游的版本 / AK 冲突、
 * 复用页面已存在的全局、失败后移除 script。也因此**没有任何路径**调用官方 `reset()`、
 * 删除上游 script / 回调全局 / `window.BMap`——它们是进程级共享状态，不属于任何组件。
 *
 * 与旧实现的语义差异（评审关注点）：
 * - 失败 / 超时**不**移除官方注入的 `<script>`（官方行为），因此重试会再插一个 script 节点，
 *   这与「重试能真的重新加载」是同一件事的两面；
 * - 全部消费者取消后，底层官方任务**保留**（官方没有公开取消接口）。后续同配置请求不得另插
 *   SDK script——官方模块级单例会返回同一个 Promise，本库只如实订阅它。
 */
import { SdkRegistry, getProcessSdkRegistry } from "../SdkRegistry";
import { DEFAULT_VERSION, fingerprintConfig, type BMapLoadOptions } from "../url";
import { createLoadedJsapiV4 } from "./loaded";
import { registerJsapiV4LoadResidue } from "./load";
import {
  JSAPI_V4_DOMAIN,
  assertSupportedJsapiV4Version,
  readJsapiV4Global,
  resolveExistingJsapiV4Version,
} from "./namespace";
import {
  officialEntryUrl,
  officialJsapiLoader,
  officialMetadataOptions,
  resolveOfficialNamespace,
  toOfficialLoadError,
  toOfficialLoadOptions,
  type OfficialJsapiLoader,
} from "./official";
import type {
  BaiduJsapiV4ProviderInternalOptions,
  JsapiV4LoadMetadata,
  JsapiV4Provider,
  LoadedJsapiV4,
} from "./types";

/** 一次加载的「结果标注」：加载方式与版本来源。 */
interface LoadOutcome {
  readonly mode: JsapiV4LoadMetadata["mode"];
  readonly version: string;
  readonly versionSource: JsapiV4LoadMetadata["versionSource"];
}

export class BaiduJsapiV4Provider implements JsapiV4Provider {
  readonly id = "baidu-jsapi-v4" as const;
  private readonly loader: OfficialJsapiLoader;
  private readonly domain: SdkRegistry;

  constructor(options: BaiduJsapiV4ProviderInternalOptions = {}) {
    this.loader = options.loader ?? officialJsapiLoader;
    this.domain =
      options.registry ?? getProcessSdkRegistry(JSAPI_V4_DOMAIN);
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig(options);
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4> {
    // 配置校验放在**进入冲突域之前**：官方路径表达不了的配置若先进域，会被当成一份「正常
    // 配置」参与指纹与冲突判定，调用方拿到的可能是 `BMAP_SDK_CONFIG_CONFLICT` 而不是
    // 「这个配置不支持」的准确原因。
    try {
      assertSupportedJsapiV4Version(options, this.id);
      toOfficialLoadOptions(options, this.id);
    } catch (error) {
      return Promise.reject(error);
    }

    const fingerprint = this.getCacheKey(options);
    return this.domain.load<LoadedJsapiV4>(
      {
        fingerprint,
        // 官方 Loader 没有公开的取消接口：消费者全部离开**不代表**底层任务结束，因此向
        // registry 声明 `cancellable: false` —— 最后一个消费者离开时只结算消费者，条目、
        // 占用与在飞任务都保留（同指纹后来者复用原任务，另一份指纹继续冲突，直到任务真正
        // 成功 / 失败）。官方 React 封装 `react-bmap` 的 registry 也是这个语义：
        // promise 注册后一直保留，只有**失败**才删除条目，组件卸载只忽略结果。
        //
        // 单个消费者的取消仍由 registry 的订阅侧完成（见 `SdkRegistry.subscribe`）：
        // `signal` 只影响自己，A 取消不会结算 B。
        cancellable: false,
        loader: () => this.performLoad(options, fingerprint),
      },
      signal,
    );
  }

  private async performLoad(
    options: BMapLoadOptions,
    fingerprint: string,
  ): Promise<LoadedJsapiV4> {
    // `load()` 已校验过；这里再取一次映射结果，避免把「校验」与「映射」拆到两处漂移。
    const officialOptions = toOfficialLoadOptions(options, this.id);

    // 进入加载前的全局快照：既是「本次是否真的插入了 script」的判据（决定 mode），
    // 也是失败时登记残留的基线（只登记本次新出现的对象，从不删除任何全局）。
    const before = readJsapiV4Global();

    let resolved: unknown;
    try {
      resolved = await this.loader.load(officialOptions);
    } catch (error) {
      registerJsapiV4LoadResidue(before);
      throw toOfficialLoadError(error, options);
    }

    let namespace: Record<string, unknown>;
    try {
      namespace = resolveOfficialNamespace(resolved, this.id);
    } catch (error) {
      // 官方已 resolve、但结算出来的东西不是可用命名空间：同样算本次加载失败，并把它登记为
      // 「本库本次加载产生的残留」——否则后续的复用路径会把这份残缺全局当成宿主提供的全局。
      // 注意登记**不等于**可重试：官方此后状态已是 `loaded`，再 load 会命中同一份结算结果。
      registerJsapiV4LoadResidue(before);
      throw error;
    }

    const outcome = resolveLoadOutcome(options, namespace, before !== undefined, this.id);
    return createLoadedJsapiV4({
      providerId: this.id,
      mode: outcome.mode,
      version: outcome.version,
      versionSource: outcome.versionSource,
      // 代理模式下入口不带 ak：metadata 的 `akRef` 不能让人以为 AK 参与了实际入口。
      options: officialMetadataOptions(options),
      fingerprint,
      apiUrl: officialEntryUrl(options),
      namespace,
    });
  }
}

/**
 * 加载结果的标注。
 *
 * - 进入加载前页面**没有** v4 全局 ⇒ 由官方注入 script，`mode: "jsonp"`（官方唯一的就绪信号
 *   是 JSONP 回调）、版本以本次请求的 `v=4.0` 为准；
 * - 已经有全局 ⇒ 官方直接复用（`console.warn` 且不注入 script），版本判定与其它 Provider
 *   共用 `resolveExistingJsapiV4Version()`（探测到 4.x 标 `global`，否则如实标 `declared`）。
 */
function resolveLoadOutcome(
  options: BMapLoadOptions,
  namespace: unknown,
  preexistingGlobal: boolean,
  providerId: string,
): LoadOutcome {
  if (!preexistingGlobal) {
    return {
      mode: "jsonp",
      version: options.version ?? DEFAULT_VERSION,
      versionSource: "url",
    };
  }
  const resolved = resolveExistingJsapiV4Version(namespace, providerId, options.version);
  return {
    mode: "existing-global",
    version: resolved.version,
    versionSource: resolved.source,
  };
}

/**
 * 默认在线 Provider 工厂（与 legacy `baiduCdnProvider()` 对称；不收 AK，AK 经 loadOptions 传入）。
 *
 * 它是 `<Map>` / `<BMapProvider>` / `createBMapPlugin` / Playground 在未显式指定 Provider 时
 * 解析到的那一个：内部真的调用官方 `@baidumap/jsapi-loader`，不是「装了依赖但继续自研 JSONP」。
 */
export function baiduJsapiV4Provider(
  options: BaiduJsapiV4ProviderInternalOptions = {},
): BaiduJsapiV4Provider {
  return new BaiduJsapiV4Provider(options);
}
