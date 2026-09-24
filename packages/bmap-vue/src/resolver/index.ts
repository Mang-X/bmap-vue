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

/** v3 组件名(从 manifest 单一事实源生成) */
const v3ComponentNames = componentManifest.map((c) => c.name) as readonly string[];

const componentNameSet = new Set<string>(v3ComponentNames);

export function Vue3BaiduMapGlResolver(): ComponentResolverLike {
  return {
    type: "component",
    resolve(name) {
      if (!name.startsWith("B")) return;
      if (!componentNameSet.has(name)) return;
      return {
        name,
        from: "bmap-vue/components",
      };
    },
  };
}
