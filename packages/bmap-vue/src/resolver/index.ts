/**
 * 自动组件 resolver(unplugin-vue-components)
 *
 * 合法组件列表从 manifest 生成,不手工维护第二份。
 * 为避免强依赖 unplugin-vue-components,此处仅定义最小接口兼容(结构类型)。
 */
export interface ComponentResolverLike {
  type?: "component" | "directive";
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
