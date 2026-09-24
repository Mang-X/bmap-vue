/**
 * 服务层公共底座（M7-SERVICE-CORE / issue #38）
 *
 * 放这里的东西有两个共同点：**框架无关**（不 import vue、不 import SDK）且**被多个
 * composable 共用**。Vue 侧的绑定在 `composables/useServiceTask.ts`——那里只做
 * 「把 `ServiceResult` 写进 shallowRef」，业务语义全部落在这一层。
 */
export { SERVICE_CALL_STATUSES, settledServiceResult, toServiceErrorInfo } from "./serviceStatus";
export type { BMapServiceStatus } from "./serviceStatus";
export { createRequestGuard } from "./requestGuard";
export type { RequestGuard } from "./requestGuard";
export { jsapiV4ServicesOf } from "./invocation";
export { runSequential } from "./runSequential";
