/**
 * 每实例一次的弃用告警（M5-VECTORS / issue #31）
 *
 * 迁移文档给弃用定的契约是「**每条弃用都有稳定 code**，文档列出替代 API，**同实例只警告一次**，
 * production 默认不输出」。四件事各有落点：
 *
 * | 契约 | 落点 |
 * | --- | --- |
 * | 稳定 code | `aliases.ts` 的 `code`（`BMAP_DEPRECATED_*_ALIAS`） |
 * | 替代 API | `aliases.ts` 的 `canonical` + `note`，`describeDeprecation()` 拼成文案 |
 * | **同实例一次** | 本文件（warner 由组件实例持有，`code` 去重） |
 * | production 不输出 | `core/logger.ts` 的 `devWarn`（消费方构建期折叠 `process.env.NODE_ENV`） |
 *
 * ## 为什么去重键是 `code` 而不是「节点 / 名字」
 *
 * 一个实例上可能出现同一类的多次误用（例如同时传了 `startPoint`、又在后续渲染里改了 `endPoint`）。
 * 按名字去重会让同一句提示刷屏，按 code 去重则是「这件事已经告诉过你了」——与迁移文档承诺的
 * 「同实例只警告一次」逐字对应。**不同实例各警告一次**是刻意的：两个组件各自误用，是两件事。
 *
 * 与 `driver/jsapi-v4/internal.ts` 的 `createWarnOnce` 分开：那个是 Driver 侧的
 * 「同一次调用链里只提示一次」（诊断/能力缺口），生命周期是 Driver；这里是**组件实例级**的
 * 用法提示，随组件卸载消失，两者不共用状态。
 */
import { devWarn } from "../logger";
import type { DeprecationNotice } from "./aliases";

export interface DeprecationWarner {
  /** 记录并（首次时）输出一条弃用告警。幂等：同一个 code 只输出一次。 */
  warn(notice: DeprecationNotice): void;
  /** 已经输出过的 code（用例用来断言「只警告一次」）。 */
  readonly warned: readonly string[];
}

export function createDeprecationWarner(label?: string): DeprecationWarner {
  const warned = new Set<string>();
  return {
    warn(notice) {
      if (warned.has(notice.code)) return;
      warned.add(notice.code);
      devWarn(notice.message, { code: notice.code, ...(label ? { component: label } : {}) });
    },
    get warned() {
      return [...warned];
    },
  };
}
