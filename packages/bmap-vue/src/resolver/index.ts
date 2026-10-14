/**
 * 自动组件 resolver(unplugin-vue-components)
 *
 * 合法组件列表从 manifest 生成,不手工维护第二份。
 *
 * `type` 刻意是**必填**、而不是 `type?`：目标插件 `unplugin-vue-components` 的
 * `Options.resolvers` 要求 `ComponentResolverObject`（其中 `type` 必填）。写成可选时，
 * 消费者 `Components({ resolvers: [BMapResolver()] })` 会被 TS 拒绝 —— 尽管运行时返回的
 * 对象确实带 `type`（#221：类型把可用的东西挡在门外）。这里仍只做**结构**兼容，
 * 不 import 该包（它是可选工具链集成，不是本库的运行期 peer）。
 */
export interface ComponentResolverLike {
  type: "component" | "directive";
  resolve: (name: string) => { name: string; from: string } | undefined | void;
}

import { componentManifest } from "../manifest";
import { LIBRARY_PACKAGE_NAME } from "../version";

/** 组件名（从 manifest 单一事实源生成） */
const v3ComponentNames = componentManifest.map((c) => c.name) as readonly string[];

const componentNameSet = new Set<string>(v3ComponentNames);

export function BMapResolver(): ComponentResolverLike {
  return {
    type: "component",
    resolve(name) {
      if (!componentNameSet.has(name)) return;
      return {
        name,
        // 包名在**构建期**从 manifest 注入（见 version.ts）。写死字符串的后果不是
        // 「找不到包」：`bmap-vue` 这个无 scope 名在 npm 上属于另一位作者，用户的
        // unplugin-vue-components 会照抄这句话，于是 import 到**错误的项目**。
        from: `${LIBRARY_PACKAGE_NAME}/components`,
      };
    },
  };
}
