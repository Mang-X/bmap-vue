// 只引入根入口（#158 工作包 D）：用来证明「不显式 import styles.css 就不会拿到那份 CSS」，
// 以及默认根入口不静态拉进可选的官方 UI Kit。
//
// ⚠️ 同 `entry-with-styles.ts`：必须有顶层副作用避免被摇成 0 字节。
import { Map } from "bmap-vue";

globalThis.__stylesRootOnlyProbe = [Map];
