# MVTLayer 矢量瓦片图层

MVT 矢量瓦片（官方 `BMap.MVTLayer`，4.0）：按**源图层名**过滤要素、按源图层名套样式，
并提供要素状态（feature-state）命令面。

```ts
import { MVTLayer, mvtFeatureStateKey } from 'bmap-vue'
```

## 组件示例

```vue
<template>
  <Map :center="{ lng: 116.4, lat: 39.9 }" :zoom="12">
    <MVTLayer
      tile-url-template="https://example.com/tiles/[z]/[x]/[y].pbf"
      :layers="['lines', 'pts']"
      id-property="fid"
      :style="{
        lines: { type: 'polyline', painter: { strokeColor: '#0f0', strokeWeight: 2 } },
        pts: { type: 'point', painter: { color: '#f00', size: 6 } },
      }"
      @click="onPick"
    />
  </Map>
</template>
```

::: warning 占位符与 `layers` 形状
- URL 占位符是 **`[z]` / `[x]` / `[y]`**；`{z}` 不会被解析。
- `layers` 必须是**源图层名字符串数组**（如 `["lines", "pts"]`）。官方 d.ts 的 `MVTLayerConfig[]`
  对象数组会让 worker 的 `layers.indexOf(name)` 恒为 `-1`，整层渲染为空。
- 样式在给了 `layers` 时按**源图层名键**读（`{ lines: { type, painter } }`）；不传 `layers`
  才会退回 `point` / `line` / `fill` 扁平路径。
:::

## 统一槽位

图层的统一槽位由**同一个生命周期内核**处理：`visible` 表达为「挂上 / 摘掉」。

| 属性 | 说明 | 类型 | 默认值 | 本图层的更新口径 |
| --- | --- | --- | --- | --- |
| visible | 是否挂在地图上 | `boolean` | `true` | 挂上 / 摘掉（不重建） |
| minZoom | 最小显示层级 | `number` | SDK 默认 | 变化时**重建**（官方没有 setter） |
| maxZoom | 最大显示层级 | `number` | SDK 默认 | 变化时**重建** |
| zIndex | 图层层叠顺序 | `number` | SDK 默认 | **就地** `setZIndex()` |

**不声明** `opacity`、也不把 `visible` 做成 setter 语义：官方 `MVTLayer` 的声明与运行时都没有
`setOpacity` / `setVisible` / `setData`，`minZoom` / `maxZoom` 也没有对应 setter（所以变化时
**重建**）。因此 `visible` 表达为「挂上 / 摘掉」，而 `zIndex` 走官方声明的 `setZIndex()` **就地**更新。

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 | 更新口径 |
| --- | --- | --- | --- | --- |
| tileUrlTemplate | MVT 瓦片地址；占位符 `[z]` / `[x]` / `[y]` | `string` | - | **重建** |
| layers | 参与渲染的源图层名数组 | `string[]` | - | **重建** |
| idProperty | 要素身份字段（拾取与 feature-state 的唯一口径） | `string` | - | **重建** |
| style | 源图层样式映射（见下） | `MVTLayerStyle` | - | **就地** `setStyle()`（整袋） |

其余 `MVTLayerOptions` 逃生口（`transform` / `gridModel` / `spanLevel` / `noCollision` /
`useThumb` / `encrypt` / `onclick` / `ondblclick` / `onmousemove` / `onmouseout`）原样透传，
不做逐项重命名。

### 样式形状

```ts
{
  lines: { type: 'polyline', painter: { strokeColor: '#0f0', strokeWeight: 2 } },
  pts:   { type: 'point',     painter: { color: '#f00', size: 6 } },
}
```

`painter` 的字段表没有可逐字段核对的声明面，本库按源图层名的键值袋**原样透传**。

## 事件与拾取

六个事件名与官方 `MVTLayerEventMap` 一致：

`click` / `dblclick` / `mousemove` / `mouseout` / `tilesloadstart` / `tilesloadend`

拾取走事件的 `value`（`Entity[]`）；官方 `pickFeatures(x, y)` 真实运行时返回空，本库**不**包装它。
`idProperty` 决定 `value[].id` 是业务值还是 feature number 的字符串形式。

`mousemove` 的 `value` **必有**（官方 `MVTLayerMouseMoveEvent` 的声明如此），而 `click` / `dblclick`
的 `value` **可选**——未命中时 SDK 可能不带。两者不能互相顶替，类型上因此不是同一个别名。

## Feature State（要素状态）

经 `defineExpose({ featureState })` 给出命令面（不是 prop）：

```ts
import { mvtFeatureStateKey } from 'bmap-vue'

const layerRef = ref<InstanceType<typeof MVTLayer> | null>(null)

// 键必须是复合 `layerName_id`；样式须先含 feature-state 表达式才有可见效果
layerRef.value?.featureState.update(mvtFeatureStateKey('lines', 'road-1'), { selected: true })
layerRef.value?.featureState.get()          // getAllState
layerRef.value?.featureState.remove('lines_road-1')
layerRef.value?.featureState.replace({ 'lines_road-1': { hovered: true } }) // replaceAllState
layerRef.value?.featureState.clear()        // clearState
```

- **键域是 string-only**：数字键在任何 SDK 调用之前被拒绝。
- **身份前置**：`idProperty` 未声明时五个命令一律拒绝（告警一次）。
- **样式前置**：样式里必须先含 `feature-state` 表达式，写入才有可见效果。

## 稳定性

官方 4.0 的 `MVTLayer`（真实运行时与 4.0.5 类声明双向取证）；本库在能力清单中以 `native` 收录
（`layer.mvt`）。未声明成员一律不提供——声明了再忽略属于假支持。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.5` 的类声明。
- 图层总览见「[图层总览](./index.md)」。
