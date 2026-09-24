/**
 * 服务任务两档的**类型面**契约（issue #139，评审 P2）
 *
 * ## 为什么这是一个独立的门禁，而不是放在 `*.test.ts` 里
 *
 * 两档的验收项之一是「simple path 的类型面不携带 exclusive 能力」——它只能用
 * `@ts-expect-error` 钉（运行期看不出来：`SimpleServiceTaskOptions` 与
 * `ExclusiveServiceTaskOptions` 在 JS 里是同一个对象，差别全在类型层）。
 *
 * 而 `serviceTask.test.ts` 里的 `@ts-expect-error` **没有判别力**：`tsconfig.build.json` 排除
 * `src/` 下的 `*.test.ts`，`tsconfig.tests.json` 只 include `tests/performance` 与
 * `tests/browser/live-performance`——本文件不在任何一个 typecheck 的编译范围里。
 *
 * 这一点**实测过**：给 `SimpleServiceTaskOptions` 加回 `release?`（即把简单档意外放宽）
 * 之后，`typecheck:package` 退出码 0、`typecheck:tests` 退出码 0、`serviceTask.test.ts`
 * 16/16 全绿。评审说得对：把它描述成「编译期断言」是不诚实的。
 *
 * 所以这里立一个**只**覆盖类型契约的小 fixture + 独立 tsconfig（`tsconfig.type-contracts.json`
 * + `pnpm typecheck:type-contracts`，CI 有对应步骤）。不需要把 `packages/` 下的 `*.test.ts` 全量纳入
 * typecheck——那些文件有大量既存错误，全量纳入是另一个票的工作量。
 *
 * **判别力是双向的**：`@ts-expect-error` 在「错误消失」时会变成 TS2578（unused）而翻红。
 * 所以一旦 `SimpleServiceTaskOptions` 被放宽成接受 `release`（或退化成 `any`），本文件**立刻红**。
 * 下方的正控（独占档**确实**接受 `release` / `invalidateService`）保证这不是「因为类型退化成
 * 什么都能收」而恒绿。
 *
 * 命名 `*.type-test.ts`（不是 `*.test.ts`）：vitest 的 include 是 `tests/` 下的 `*.test.ts`，
 * 这类文件不含任何 `it()`，不该被当运行时用例收集。
 */
import type { BMapClient } from "../../packages/bmap-vue/src/client/types";
import type { ServiceCall } from "../../packages/bmap-vue/src/driver/types/services";
import type { ServiceInvokeContext } from "../../packages/bmap-vue/src/composables/serviceTask";
import type {
  SimpleServiceTask,
  SimpleServiceTaskOptions,
  ExclusiveServiceTask,
  ExclusiveServiceTaskOptions,
} from "../../packages/bmap-vue/src/composables/serviceTask";

interface StubHandle {
  readonly serial: number;
}

/** 两条档共有的合法构造项。 */
const common = {
  capability: "service.geocoder" as const,
  create: (_context: ServiceInvokeContext): StubHandle => ({ serial: 1 }),
  invoke: (
    _context: ServiceInvokeContext,
    _handle: StubHandle,
    _arg: string,
  ): ServiceCall<number> => ({}) as ServiceCall<number>,
};

/* ------------------------------------------------------------------ 简单档：拒绝 */

type SimpleOptions = SimpleServiceTaskOptions<number, StubHandle, [string]>;

// @ts-expect-error 简单档刻意不接受 `release`：官方没有实例销毁入口，传了就是无消费者的死状态
const _simpleWithRelease: SimpleOptions = { ...common, release: () => {} };

// @ts-expect-error 简单档刻意不接受 `supersede`
const _simpleWithSupersede: SimpleOptions = { ...common, supersede: "recreate" };

// @ts-expect-error 简单档刻意不接受 `refuseMessage`
const _simpleWithRefuse: SimpleOptions = { ...common, refuseMessage: "busy" };

/**
 * 正控：把三个独占档字段**一起**给也仍然报错。
 *
 * `@ts-expect-error` 必须贴在**报错行**上：TS 的多余属性检查（TS2353）报在具体属性位置
 * 而不是整个字面量上。写在 `const` 那行会被判成 unused（TS2578）——这正是本门禁
 * 「双向可判别」的一个实例：指令失效与类型被放宽**同样**翻红。
 *
 * 三个字段**不能**各贴一条指令：TS 的多余属性检查在第一个未知属性处就短路（这里报
 * `release`），后两条会变成 unused。所以这个正控只需一个指令；`supersede` 与
 * `refuseMessage` 由上面两条独立用例各自覆盖。
 */
const _simpleWithAll: SimpleOptions = {
  ...common,
  // @ts-expect-error 简单档不接受这三个字段（多余属性检查在第一个未知属性 `release` 处短路）
  release: (_client: BMapClient, _handle: StubHandle) => {},
  supersede: "recreate",
  refuseMessage: "busy",
};

/* ------------------------------------------------------ 简单档：返回面没有 invalidateService */

declare const simpleTask: SimpleServiceTask<number, [string]>;

// @ts-expect-error 简单档的返回面**不暴露** `invalidateService`（#139 的验收项）
simpleTask.invalidateService;

// 简单档确实**有**这些（正控：证明上面的 `@ts-expect-error` 不是因为「接口整体是 any」）
const _simpleHasData: unknown = simpleTask.data;
const _simpleHasStatus: unknown = simpleTask.status;
const _simpleHasCancel: unknown = simpleTask.cancel;

/* -------------------------------------------------------------- 独占档：接受（正控） */

type ExclusiveOptions = ExclusiveServiceTaskOptions<number, StubHandle, [string]>;

/** 正控：独占档**确实**接受 `release`——否则上面那几条可能只是「两边都不收」。 */
const _exclusiveWithRelease: ExclusiveOptions = {
  ...common,
  release: (_client: BMapClient, _handle: StubHandle) => {},
};

const _exclusiveWithSupersede: ExclusiveOptions = { ...common, release: () => {}, supersede: "recreate" };

declare const exclusiveTask: ExclusiveServiceTask<number, [string]>;

/** 独占档**确实**暴露 `invalidateService`（与简单档对照的那一半）。 */
const _exclusiveInvalidate: unknown = exclusiveTask.invalidateService;

/** 独占档的返回面是简单档的超集（`extends`），所以简单档的成员也都在。 */
const _exclusiveInheritsSimple: unknown = exclusiveTask.data;

/** 引用全部 fixture，避免 `noUnusedLocals` 风格的诊断把它们当死代码。 */
export const typeContractFixtures = [
  _simpleWithRelease,
  _simpleWithSupersede,
  _simpleWithRefuse,
  _simpleWithAll,
  _simpleHasData,
  _simpleHasStatus,
  _simpleHasCancel,
  _exclusiveWithRelease,
  _exclusiveWithSupersede,
  _exclusiveInvalidate,
  _exclusiveInheritsSimple,
];
