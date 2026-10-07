// 显式引入样式子路径（#158 工作包 D）：这是安装文档与 README 教消费者的写法，
// 也是「样式不会自动注入、必须显式 import」这条边界的正证。
//
// ⚠️ 必须有**顶层副作用**，否则打包器会把入口摇成 0 字节（同 `shake/root-entry.ts` 的注解），
// 那样判的就不是「样式有没有被打进来」而是「什么都没打包」。
import { Map } from "bmap-vue";
import "bmap-vue/styles.css";

globalThis.__stylesWithStylesProbe = [Map];
