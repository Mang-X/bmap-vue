import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../packages/bmap-vue/package.json"), "utf8"),
);

export const versionDefine = {
  __VERSION__: JSON.stringify(packageJson.version),
  // 包名同样在**构建期**注入：`BMapResolver` 会把组件的 `from` 写成
  // `<pkg>/components`，而 unplugin-vue-components 会把那句话**原样写进用户的代码**。
  // 写死 `bmap-vue` 的后果不是「找不到包」——npm 上那个无 scope 名恰好属于另一位作者，
  // 于是会解析到**错误的项目**。1.0 迁到 `@mangax/bmap-vue` 后，这条必须跟着 manifest 走。
  //
  // 为什么在构建期注入而不是运行时读 package.json：resolver 会被打进浏览器 bundle，
  // 运行时没有 `node:fs`，也没有可靠的「我被装在哪个包里」信息（bundler 可能改写）。
  // 构建期是唯一能确定真值的地方。
  __PKG_NAME__: JSON.stringify(packageJson.name),
};
