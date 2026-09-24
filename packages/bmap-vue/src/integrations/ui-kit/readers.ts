/**
 * UI Kit 事件 / 回包载荷的**字段读取**原语（`./ui-kit` 内部工具）
 *
 * 为什么单独一个文件：`points.ts`（地点类载荷）与 `routePlan.ts`（路线类载荷）都要做同一件事
 * —— 把上游交给我们的 `unknown` 逐字段读成纯数据。读法只有一套口径，两处各写一份迟早会漂移
 * （例如一处把缺字段读成 `""`、另一处读成 `undefined`，调用方拿到的语义就不一样了）。
 *
 * 三条口径：
 * - **不补默认值**：缺字段就是「没有」，读成 `undefined` 而不猜一个业务默认值；
 * - **不抛错**：上游形状异常时返回 `undefined`，由调用方决定「整条丢弃」还是「跳过这一项」；
 * - **只读已知键**：不做深拷贝式透传，上游新增字段不会自动泄进公共契约。
 */

/** 非 null 的对象（数组也算对象，需要时调用方自己再排）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 读字符串字段；非字符串一律当成空串（上游契约里这些字段必定是字符串）。 */
export function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

/** 读可选字符串：缺失 / 空串 / 非字符串都给 `undefined`，避免把「没有」写成空串。 */
export function readOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 读可选数字：只接受有限数（`NaN` / `Infinity` / 字符串数字一律当成不可用）。 */
export function readOptionalNumber(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 读字符串数组；非数组返回 `undefined`，数组里的非字符串项被丢弃。 */
export function readStringList(
  source: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length > 0 ? out : undefined;
}

/**
 * 逐项投影一个数组载荷，**丢掉**投影失败（返回 `null`）的项。
 *
 * 非数组返回空数组：上游异常形态按「一条都没有」处理，不抛错也不制造占位项。
 */
export function collect<T>(
  value: unknown,
  project: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const projected = project(item);
    if (projected !== null) out.push(projected);
  }
  return out;
}
