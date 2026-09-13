/**
 * 探针页的浏览器侧声明。
 *
 * 只为「一次性类型检查」服务：Vite 自己处理 CSS 导入，而 `tsc` 需要一条
 * 模块声明才能接受 `import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css"`。
 */
declare module "*.css";
