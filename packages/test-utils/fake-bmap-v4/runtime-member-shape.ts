/**
 * Fake v4：**运行时成员面是分阶段就位**的（#165c 复核，live AK 读数）
 *
 * ## 背景：这份名单为什么存在
 *
 * #165 审计记的三条「运行时损坏」里有两条（`CityListControl` 的命令面、
 * `CopyrightControl#removeCopyright`）**经复核是取样错位**，不是缺陷——那些成员在稳定态
 * 全部在位且真调得动。但复核过程中取到了**一条真的**，且它比原结论更值得修：
 *
 * > **官方 loader 的就绪信号早于控件成员面补齐约 150ms。**
 *
 * live 读数（`scripts/probe-165c-surface.mts`，多次独立复跑，窗口 126–167ms）：
 *
 * | 观察点 | `CityListControl.prototype` | `CopyrightControl.prototype` |
 * | --- | --- | --- |
 * | 官方 `callback` 触发（= loader 判「已加载」） | **3** 个成员（无 `toggle` / `getCityName`） | **8** 个（无 `removeCopyright`） |
 * | `new BMap.Map()` 之后 | 3 | 8 |
 * | 再让出一个宏任务 | 3 | 8 |
 * | +~150ms | **26**（`toggle` / `getCityName` 都在，且调得动） | **16**（`removeCopyright` 在，且调得动） |
 *
 * 补齐**不是**被建图触发的（不建图纯等也会补齐），因此本库「loader 判就绪 → 建图 → 建控件」
 * 这条正常路径**恰好落进窗口里**。窗口内 `addCopyright` **已经可用**、`removeCopyright`
 * **不可用**——所以第一个失败的是**卸载**，而不是挂载。
 *
 * ## 这份名单干什么用
 *
 * 名单里的成员是「**补齐之前不在、稳定态在**」。它们**必须由 Fake 提供**（否则测试根本进不去
 * 这条路径，等于把整个窗口测没了），但**必须能被切换掉**（否则「窗口里会失败」这条就永远
 * 测不出来——而那正是要防的回归）。
 *
 * `installDeferredRuntimeMembers()` 卸下它们，模拟「成员面还没补齐」；`resetRuntimeMemberShape()`
 * 装回。这让「窗口内卸载」成为一条**可执行**的用例，而不是只写在注释里的注意事项。
 *
 * ## 与 `FAKE_V4_RUNTIME_INJECTED_MEMBERS` 的分别
 *
 * 那份名单是「**整个类**在不在」（`PointLayer` / `ClusterLayer` …，连构造器都没有）；
 * 这份是「**类在、成员不在**」。两者都是「运行时才到位」，但粒度不同，处置也不同：
 * 前者模拟「扩展 API 尚未注入」，后者模拟「控件模块尚未补齐成员面」。
 */
import type { FakeBMapV4 } from './index.ts'

/**
 * 官方声明里有、**补齐之前**不在（稳定态在且调得动）的成员，按类分组。
 *
 * ⚠️ 名单只列**实测**落在后补那一批的成员。`getTriggerDom` 不在其中——它在
 * `CityListControl` 的 26 成员里，但本库**刻意不暴露**（返回 raw `HTMLElement`，
 * 收窄投影不成立，见 `driver/types/controls.ts` 的 `CityListCommandApi`），
 * 因此 Fake 也没实现它；把「不实现」和「暂时不在」混进同一张表会让两种原因无法区分。
 */
export const FAKE_V4_DEFERRED_RUNTIME_MEMBERS = {
  CityListControl: ['open', 'close', 'toggle', 'getCityName'],
  CopyrightControl: ['removeCopyright'],
} as const satisfies Record<string, readonly string[]>

export type FakeV4DeferredControlKind = keyof typeof FAKE_V4_DEFERRED_RUNTIME_MEMBERS

/**
 * 找到**真正持有**该成员的原型对象。
 *
 * 命名空间里的 `CityListControl` 是 `class CityListControlClass extends FakeV4CityListControl`，
 * 成员挂在**父类**原型上，而 `delete` 只作用于**自有**属性——直接在子类原型上 `delete`
 * 是彻底的静默无操作（本轮真的踩过一次：断言「已卸下」却读到 `function`）。
 * 因此沿原型链往上找第一个**自有**该成员的原型，找不到就返回 `null`（成员本来就不在）。
 */
function definingPrototype(root: object, member: string): object | null {
  let current: object | null = root;
  while (current) {
    if (Object.prototype.hasOwnProperty.call(current, member)) return current;
    current = Object.getPrototypeOf(current);
  }
  return null;
}

/** 每个 Fake 各自一份备份表：同一个 fake 可能被反复装 / 卸，且要按「所在原型」原样装回。 */
interface DeferredBackup {
  /** 真正**持有**该成员的原型（子类 / 父类原型不混）。 */
  readonly proto: object
  readonly member: string
  readonly value: unknown
}

const deferredBackups = new WeakMap<FakeBMapV4, Map<string, DeferredBackup>>()

function backupTable(fake: FakeBMapV4): Map<string, DeferredBackup> {
  let table = deferredBackups.get(fake)
  if (!table) {
    table = new Map()
    deferredBackups.set(fake, table)
  }
  return table
}

/**
 * 卸下「补齐之前不在」的成员 ⇒ 模拟成员面尚未就绪的窗口。幂等。
 *
 * 走 `definingPrototype` 删**持有者**上的自有属性，并把真身连同所在原型记进备份表，
 * 装回时才能删到同一个对象上（子类 / 父类原型不混）。
 */
export function installDeferredRuntimeMembers(fake: FakeBMapV4): void {
  const namespace = fake.namespace as unknown as Record<string, { prototype: object }>
  const table = backupTable(fake)
  for (const [ctorName, members] of Object.entries(FAKE_V4_DEFERRED_RUNTIME_MEMBERS)) {
    const proto = namespace[ctorName]?.prototype
    if (!proto) continue
    for (const member of members) {
      const key = `${ctorName}.${member}`
      if (table.has(key)) continue
      const owner = definingPrototype(proto, member)
      if (!owner) continue
      const holder = owner as unknown as Record<string, unknown>
      table.set(key, { proto: owner, member, value: holder[member] })
      delete holder[member]
    }
  }
}

/** 把 `installDeferredRuntimeMembers()` 卸下的成员装回（幂等）。 */
export function resetRuntimeMemberShape(fake: FakeBMapV4): void {
  const table = deferredBackups.get(fake)
  if (!table) return
  for (const { proto, member, value } of table.values()) {
    ;(proto as unknown as Record<string, unknown>)[member] = value
  }
  table.clear()
}
