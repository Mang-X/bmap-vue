/**
 * 服务层公共底座（M7-SERVICE-CORE / issue #38，#139 分层）
 *
 * 放这里的东西有两个共同点：**框架无关**（不 import vue、不 import SDK）且**被多个
 * composable 共用**。服务任务分两档（见 ADR
 * `2026-09-24-service-task-and-resource-scope-split.md`）：
 *
 * - 状态口径（能力门 / 按 Client 缓存 / 只读状态 / 过期保护）在本层的 `serviceTaskCore.ts`；
 * - 实例所有权（要不要换新实例、谁来释放）在本层的 `instanceChannel.ts`——**简单服务用无状态
 *   通道**（官方没有实例销毁入口），**LocalSearch / 路线服务用独占通道**（官方有 `dispose*`）。
 *
 * Vue 侧的绑定是 `composables/serviceTask.ts` 的两档工厂——那里只做「把 `ServiceResult` 写进
 * shallowRef」与生命周期接线，业务语义全部落在这一层。
 */
export { SERVICE_CALL_STATUSES, settledServiceResult, toServiceErrorInfo } from "./serviceStatus";
export type { BMapServiceStatus } from "./serviceStatus";
export { createRequestGuard } from "./requestGuard";
export type { RequestGuard } from "./requestGuard";
export { jsapiV4ServicesOf } from "./invocation";
export { runSequential } from "./runSequential";
