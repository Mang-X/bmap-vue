/**
 * `BCopyright` 的共享控件缓存
 *
 * 文档承诺「多个相同位置版权控件会自动排列，避免重叠」，实现方式是**同一 anchor 的多个组件
 * 共用一个 `CopyrightControl` 实例**、各自往里加一条版权项。
 *
 * 本模块原先是一张**模块级** `Map<string, ControlHandle>`（键只有 anchor），于是同一页面上的
 * 两个 `<BMap>`（两个 Client）会复用同一个句柄——而句柄的所有权绑定在创建它的 Client 上，
 * 跨 Client 使用会被 Driver 的注册表判成 `BMAP_HANDLE_FOREIGN`（M7-CONTROL-PANORAMA / #41
 * 实测：第二个 Client 下的 `<BCopyright>` 直接建不出控件）。因此键改成
 * **Client 身份 + anchor**，用 `WeakMap` 分桶：
 *
 * - 跨 Client 不会复用（修掉上面那条真实缺陷）；
 * - Client 被回收时整桶随之消失，不会长期持有已销毁 SDK 对象。
 *
 * 仍然存在的限制（`docs/adr/2026-09-17-control-spec-and-panorama.md` 的「已知限制」第 1 条）：
 * `anchor` 会随 props 变化，而桶的键是**创建时**的 anchor——移动后的实例不会重新入桶。
 */
import type { BMapClient } from "../../client/types";
import type { MapReadyContext } from "../../core/context/types";
import type { ControlHandle } from "../../driver/types/handles";

export type CopyrightEntry = {
  id: number;
  content: string;
  bounds?: unknown;
};

/** Client → （anchor → 共享控件）。 */
const cacheByClient = new WeakMap<BMapClient, Map<string, ControlHandle>>();

function bucket(client: BMapClient, create: boolean): Map<string, ControlHandle> | undefined {
  let bucketOfClient = cacheByClient.get(client);
  if (!bucketOfClient && create) {
    bucketOfClient = new Map<string, ControlHandle>();
    cacheByClient.set(client, bucketOfClient);
  }
  return bucketOfClient;
}

/** 取该 Client 在该停靠位置上共享的控件（没有则 `undefined`）。 */
export function getCopyrightControl(client: BMapClient, anchor: string): ControlHandle | undefined {
  return bucket(client, false)?.get(anchor);
}

/** 登记该 Client 在该停靠位置上共享的控件。 */
export function setCopyrightControl(
  client: BMapClient,
  anchor: string,
  control: ControlHandle,
): void {
  bucket(client, true)!.set(anchor, control);
}

/** 已经没有任何版权项时把共享控件摘掉并出桶（还有兄弟组件在用就保留挂载）。 */
export function removeCopyrightControlIfEmpty(
  anchor: string,
  control: ControlHandle,
  ctx: MapReadyContext,
) {
  const entries = ctx.client.driver.controls.listCopyrights(control);
  if (entries.length > 0) return;
  ctx.client.driver.controls.remove({ kind: "map", handle: ctx.map }, control);
  bucket(ctx.client, false)?.delete(anchor);
}
