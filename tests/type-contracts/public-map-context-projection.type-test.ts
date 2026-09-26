/**
 * `PublicMapContext`（`resolveMapContext()` / `useMapContext()` 的公共返回面）
 * 的**类型面**契约（#160 评审 P1）
 *
 * ## 两条断言各自钉住什么
 *
 * 1. **`client` / `map` / `status` / `error` 不可写回。**
 *    这四个是内部 runtime 持有的**同一个** ref，窄面必须保持引用同一（否则「状态变了但
 *    窄面没变」会出现第二份真相），所以不能用新 ref / computed 隔开。代价是
 *    `Readonly<ShallowRef<…>>` 必须真的去掉 `.value` 的可写性：只在属性上标 `readonly`
 *    **不**阻止 `ctx.client.value = …`，而写入一个只满足 `PublicBMapClient` 的对象，会让
 *    库内继续按 `ShallowRef<BMapClient>` 读同一个 ref —— 类型窄化变成运行时破坏。
 * 2. **`whenReady` 保留 `signal?: AbortSignal`。**
 *    隐藏内部 runtime 面不该顺带削掉一个**仍然保留**的公共方法的参数：`signal` 是
 *    「只取消本次等待」的既有契约（与 `MapExpose.whenReady` 同）。少收它，JS / `any`
 *    调用方传进来的信号会被静默丢弃。
 *
 * ## 为什么需要独立门禁
 *
 * 同 `service-task-tiers.type-test.ts`：`src/` 下的 `*.test.ts` 不在任何 typecheck 的
 * 编译范围里，写在那里的 `@ts-expect-error` 是**恒真**的。本文件由
 * `tsconfig.type-contracts.json` + `pnpm typecheck:type-contracts` 编译，CI 有对应步骤。
 *
 * 判别力双向：`@ts-expect-error` 在「错误消失」时变成 TS2578（unused）而翻红；
 * 末尾的正控保证类型没有退化成 `any` / `unknown` 而恒绿。
 */
import type { PublicMapContext } from "../../packages/bmap-vue/src/composables/resolveMapContext";

declare const ctx: PublicMapContext;

/* ── 1. 公共投影不可写回内部 runtime 的 ref ───────────────────────────────── */

// @ts-expect-error 不能把只满足 `PublicBMapClient` 的对象写进库内按 `BMapClient` 读的 ref
ctx.client.value = {} as never;
// @ts-expect-error 同上：地图句柄 ref 同样只读
ctx.map.value = null as never;
// @ts-expect-error 同上：状态 ref
ctx.status.value = "ready" as never;
// @ts-expect-error 同上：错误 ref
ctx.error.value = new Error("boom") as never;

/* ── 2. 读取面必须仍然可用（正控：不能窄成 `never` / `any`） ─────────────── */

export const status = ctx.status.value;
export const client = ctx.client.value;
export const handle = ctx.map.value;

/* ── 3. `whenReady` 保留 AbortSignal 取消语义（正控：参数可传） ────────────── */

export const ready = ctx.whenReady();
export const cancellable = ctx.whenReady(new AbortController().signal);
