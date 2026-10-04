/**
 * 归一化调用面的取用入口（M7-SERVICE-CORE / issue #38）
 *
 * `BMapClient.driver` 的类型是共享契约 `BMapDriver`，它只承诺**创建面**
 * （`ServiceDriver`）；**归一化调用面**（`geocode` / `queryBoundary` / `search` …）按 `#23` 的
 * 分层决策只挂在 `JsapiV4Driver.services` 上。业务 composable 需要调用面，因此需要一个
 * **可检查的**收窄点。
 *
 * 为什么不是一句 `as JsapiV4ServiceDriver`：那是无条件的断言，将来真的出现第二个 engine
 * 而没有调用面时，会在某次点击里炸出「geocode is not a function」；这里按运行时成员探测，
 * 失败时给一条能读懂的错误。
 */
import { BMapError } from "../errors/BMapError";
import type { BMapClient } from "../../client/types";
import type { JsapiV4ServiceDriver } from "../../driver/types/services";

export function jsapiV4ServicesOf(client: BMapClient): JsapiV4ServiceDriver {
  const services = client.driver.services as Partial<JsapiV4ServiceDriver> | undefined;
  if (!services || typeof services.geocode !== "function") {
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `当前 engine(${client.engine}) 的 Driver 没有归一化服务调用面：` +
        "服务类 composable 依赖 `ServiceInvocationDriver`（JSAPI 4.0 Driver 提供）",
      { engine: client.engine },
    );
  }
  return services as JsapiV4ServiceDriver;
}
