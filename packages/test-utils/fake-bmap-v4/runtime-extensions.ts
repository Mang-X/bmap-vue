/**
 * Fake v4 运行时注入的可控开关（M3A3-FAKE-DUAL / issue #24 实施步骤 3）
 *
 * 官方 4.0 有一批成员是**运行时注入**的：扩展 API 的 `PointLayer` / `ClusterLayer` /
 * `Heatmap` / `TrackLine`，以及 `PanoramaCoverageLayer`。
 *
 * **「运行时注入」与「官方有没有类声明」是两个维度**（4.0.5 之后尤其要分开看）：
 * 这四个类在 `@baidumap/jsapi-v4-types@4.0.4` 里没有类声明（#23 ADR 决策 4 据此定下
 * 「能力探测不能在 Driver 构造期冻结结论」），而 4.0.5（`5ba67f4`）**补上了类声明**。
 * 但它们仍然是**运行时注入**的成员——真实浏览器里这批类要等扩展 API 注入了才能用，类型包里
 * 有声明只说明「形状已知」，不说明「加载即在」。所以这份名单按**注入时机**划分，不随
 * 类型包版本增删：`PanoramaCoverageLayer` 至今仍无声明，四个 visualization 类已有声明，
 * 但两者在这里的地位完全一样。
 */
import type { FakeBMapV4Namespace } from './index.ts'

/**
 * 运行时注入的成员名单（**运行时**提供，与类型包是否已声明无关）。
 *
 * 4.0.5 起前四个在类型包里有了类声明，但注入时机没变——所以这份名单不因上游补声明而增删。
 */
export const FAKE_V4_RUNTIME_INJECTED_MEMBERS = [
  'PointLayer',
  'ClusterLayer',
  'Heatmap',
  'TrackLine',
  'PanoramaCoverageLayer',
] as const

export type FakeV4RuntimeInjectedMember = (typeof FAKE_V4_RUNTIME_INJECTED_MEMBERS)[number]

export class FakeV4RuntimeExtensions {
  /** 已被卸下的成员 → 原构造器（装回时还原）。 */
  private readonly saved = new Map<FakeV4RuntimeInjectedMember, unknown>()
  /**
   * 可索引的命名空间视图：各成员的构造器类型互不相同，写回/删除必须走 `Record` 视图
   * （否则每写一个成员都要单独断言类型）。
   */
  private readonly writable: Record<string, unknown>

  constructor(namespace: FakeBMapV4Namespace) {
    this.writable = namespace as unknown as Record<string, unknown>
  }

  /** 当前被卸下的成员（模拟「可视化实现尚未注入」的状态）。 */
  uninstalled(): FakeV4RuntimeInjectedMember[] {
    return [...this.saved.keys()]
  }

  /**
   * 把成员从命名空间卸下。
   *
   * 幂等：已经卸下、或该成员本来就不在命名空间里，都返回 `false` 而不是抛错
   * （与 Driver 侧 `remove` 的幂等口径一致——重复调用不该让测试有机会「碰巧通过」）。
   */
  uninstall(member: FakeV4RuntimeInjectedMember): boolean {
    if (this.saved.has(member)) return false
    const value = this.writable[member]
    if (value === undefined) return false
    this.saved.set(member, value)
    delete this.writable[member]
    return true
  }

  /** 装回成员；未被卸下时是 no-op。 */
  install(member: FakeV4RuntimeInjectedMember): boolean {
    if (!this.saved.has(member)) return false
    this.writable[member] = this.saved.get(member)
    this.saved.delete(member)
    return true
  }

  /**
   * 全部装回。
   *
   * 用例开头与结尾、以及引擎描述的 `reset()` 都应调用它：一个忘了恢复的用例会把
   * 「命名空间缺成员」带进后续用例，而那种失败会伪装成「Driver 探测错了」。
   */
  restoreAll(): void {
    for (const member of [...this.saved.keys()]) this.install(member)
  }
}
