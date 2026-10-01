<template>
  <Map enable-wheel-zoom :zoom="9">
    <DistrictLayer
      name="北京市"
      :kind="DistrictType.AREA"
      auto-viewport
      :fill-color="hovered ? '#9169db' : '#fdfd27'"
      :fill-opacity="0.6"
      stroke-color="#231cf8"
      :stroke-weight="1"
      :on-complete="onComplete"
      @mouseover="hovered = true"
      @mouseout="hovered = false"
    />
  </Map>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { DistrictLayer, DistrictType } from "@mangax/bmap-vue";

/**
 * `kind` 是官方 `DistrictLayer` 的**下钻层级**（`0` 本级 / `1` 下一级 / `2` 再下一级），
 * `DistrictType` 是本库给这三个数字起的领域别名：传「北京市」+ `AREA` 会下钻到区县。
 *
 * 描边 / 填充这一组在官方 `DistrictLayer` 上全是**构造选项**（官方没有字段级 setter），变化时
 * 图层会重建——所以这里用一个布尔量表达高亮，而不是在事件里调 `setFillColor`。
 *
 * `onComplete` 是**唯一**的例外：它是**回调型 prop**（不是事件——这批图层没有 `dataparsed`
 * 事件面），经转发包装交给 SDK，换回调不重建图层。它是「边界什么时候画完」唯一的官方入口。
 *
 * 只按行政区代码查询时用 `adcode`（官方明确它**优先级高于** `name`）；`name` 仍是必填 prop，
 * 给它传同一个名称占位即可，不影响结果。
 */
const hovered = ref(false);

function onComplete() {
  console.log("行政区边界已绘制完成");
}
</script>
