/**
 * TrackLine 播放命令面（#110）
 *
 * 官方 4.0 扩展 API `TrackLine` 公开七条播放方法（`start` / `pause` / `resume` / `stop` /
 * `setSpeed` / `setProcess`，加上已有的 `setData`）。本模块把六条**播放**命令收成一处实现，
 * 口径与 `featureState.ts` 同源：
 *
 * | 命令 | 官方入口 | 语义 |
 * | --- | --- | --- |
 * | `start()` | `start()` | 从当前位置开始播放 |
 * | `pause()` | `pause()` | 暂停（进度停住；不改业务播放意图之外的状态） |
 * | `resume()` | `resume()` | 从暂停处继续 |
 * | `stop()` | `stop()` | 停止播放（live 探针：stop 后 `process` **未**归零，见夹具 `cmd.stop.observed`） |
 * | `setSpeed(n)` | `setSpeed(n)` | 倍速：有限正数 |
 * | `setProcess(p)` | `setProcess(p)` | 进度 0–1（含端点） |
 *
 * ## 依据：live 探针，不是类型包
 *
 * `@baidumap/jsapi-v4-types@4.0.4` **没有** `TrackLine` 类声明。六条方法名与
 * 合法入参的**可调用性**均经 live 探针取证（`scripts/probe-track-line.mts`，2026-09-23，
 * exit 0；夹具 `tests/behavior/fixtures/probe-track-line.live.json`）。在拿到读数之前不猜
 * 方法名——这是 #110 的硬门。**参数边界**（`setProcess ∈ [0,1]`、`setSpeed > 0`）来自官方
 * 参考面（`.agents/skills/bmap-jsapi-v4/references/runtime-extended-apis.md`），探针只证了
 * 合法值可调用，**没有**穷举非法值让 SDK 拒绝——非法值由本库在调用前拦截（与 `featureState` 同源）。
 *
 * ## 没有内部状态机
 *
 * 本模块**不**镜像 SDK 的播放状态（`idle / running / paused / …`）。命令是**发出去**的：
 * 是否真的暂停了，由 SDK 派发的 `progress` / `statuschange` 事件回答（组件侧的 `observed` 只读
 * 这些事件，不做推断）。「暂停后再 resume」这类顺序由调用方自己保证——SDK 是唯一的真值源。
 *
 * ## 校验前置于调用
 *
 * `setProcess` 越界 / `setSpeed` 非法在**任何 SDK 调用之前**抛 `BMAP_INVALID_ARGUMENT`
 * （与 `featureState` 同一条：参数错误不是 SDK 失败，不该走 `sdkCall` 的错误归一）。
 * 「不支持」不在这里判：由 Driver 的 `supports()` / `assertSupported()` 给出
 * `BMAP_CAPABILITY_UNSUPPORTED`，两处各判一次会分叉。
 *
 * 本文件是**框架无关**的（不 import vue）：入参只有归一化的 `NativeLayerDriver`、句柄取值器与
 * 一个组件名，因此可以在没有 Vue 的单测里直接驱动。
 */
import { BMapError } from "../errors/BMapError";
import { createDevWarnOnce } from "../logger";
import type {
  NativeLayerDriver,
  NativeLayerHandle,
} from "../../driver/types/native-layers";

/** 播放命令名（诊断与 `warnOnce` 的键都用它们）。 */
export type TrackLinePlaybackCommand =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "setSpeed"
  | "setProcess";

export interface TrackLinePlaybackApi {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** 倍速：有限正数；非法值抛 `BMAP_INVALID_ARGUMENT`。 */
  setSpeed(speed: number): void;
  /** 进度 0–1（含端点）；越界抛 `BMAP_INVALID_ARGUMENT`。 */
  setProcess(process: number): void;
}

export interface CreateTrackLinePlaybackApiInput {
  /**
   * **当前会话**（Driver + 句柄）的取值器；未就绪（或已释放）时返回 `null`。
   *
   * 每条命令都重新求值（与 `featureState` 同源）：图层会因构造期选项变化而换实例，
   * 闭包里的旧句柄会让命令打进一个已经不在地图上的图层。
   */
  session(): TrackLinePlaybackSession | null;
  /** 调用方名字（组件名）：参数错误与「未就绪」的告警都点名它。 */
  component: string;
}

/** 一次可用的播放会话（两个引用必须来自**同一时刻**，因此一起给）。 */
export interface TrackLinePlaybackSession {
  readonly driver: NativeLayerDriver;
  readonly handle: NativeLayerHandle;
}

function invalidArgument(component: string, detail: string): BMapError {
  return new BMapError("BMAP_INVALID_ARGUMENT", `${component}: ${detail}`, { component });
}

/**
 * `setSpeed` / `setProcess` 的**纯谓词**（边界来自官方参考面，不是 SDK 拒绝行为的读数）。
 *
 * Driver 与命令面共用这两条，避免两处各写一遍条件后分叉。
 */
export function isValidTrackLineSpeed(speed: unknown): speed is number {
  return typeof speed === "number" && Number.isFinite(speed) && speed > 0;
}

export function isValidTrackLineProcess(process: unknown): process is number {
  return typeof process === "number" && Number.isFinite(process) && process >= 0 && process <= 1;
}

export function createTrackLinePlaybackApi(
  input: CreateTrackLinePlaybackApiInput,
): TrackLinePlaybackApi {
  const { component } = input;
  /** 告警按命令面实例去重（同 `featureState`：多实例时模块级键会吞掉第二个的告警）。 */
  const warnOnce = createDevWarnOnce();

  /** 未就绪时的统一出口：**不做任何事**，但要说出来（不排队、不补发）。 */
  const notReady = (command: TrackLinePlaybackCommand): void => {
    warnOnce(
      `${component}:${command}:not-ready`,
      `[${component}] ${command}() 在图层未就绪（或已释放）时被调用：本次不做任何事` +
        "（不排队、不补发）。需要确定性时请等到挂载完成后再调用",
    );
  };

  const guard = (command: TrackLinePlaybackCommand): TrackLinePlaybackSession | null => {
    const session = input.session();
    if (!session) {
      notReady(command);
      return null;
    }
    return session;
  };

  return {
    start() {
      const session = guard("start");
      if (!session) return;
      session.driver.start(session.handle);
    },

    pause() {
      const session = guard("pause");
      if (!session) return;
      session.driver.pause(session.handle);
    },

    resume() {
      const session = guard("resume");
      if (!session) return;
      session.driver.resume(session.handle);
    },

    stop() {
      const session = guard("stop");
      if (!session) return;
      session.driver.stop(session.handle);
    },

    setSpeed(speed) {
      // 校验前置于 `guard`：参数错了就说参数错，不要因为「还没就绪」而掩盖成 not-ready
      if (!isValidTrackLineSpeed(speed)) {
        throw invalidArgument(
          component,
          `setSpeed 的速度必须是有限正数，实际是 ${String(speed)}`,
        );
      }
      const session = guard("setSpeed");
      if (!session) return;
      session.driver.setSpeed(session.handle, speed);
    },

    setProcess(process) {
      if (!isValidTrackLineProcess(process)) {
        throw invalidArgument(
          component,
          `setProcess 的进度必须在 [0, 1] 内，实际是 ${String(process)}`,
        );
      }
      const session = guard("setProcess");
      if (!session) return;
      session.driver.setProcess(session.handle, process);
    },
  };
}
