<template>
  <Map
    v-bind="$attrs"
    :zoom="5"
    :center="{ lat: 39.915185, lng: 116.403901 }"
    :plugins="['Mapvgl']"
    :displayOptions="{
      indoor: false,
      poi: true,
      skyColors: ['rgba(5, 5, 30, 0.01)', 'rgba(5, 5, 30, 1.0)'],
    }"
    mapStyleId="91c53039a0b7f75e3dd8ddcdd932243b"
    enableScrollWheelZoom
    ref="bmapRef"
    @plugin-ready="handlePluginReady"
  />
</template>
<script setup>
import { ref } from "vue";
const bmapRef = ref();
function handlePluginReady() {
  const map = bmapRef.value?.getMapInstance?.();
  let data = [];

  let citys = [
    "北京",
    "天津",
    "上海",
    "重庆",
    "石家庄",
    "太原",
    "呼和浩特",
    "哈尔滨",
    "长春",
    "沈阳",
    "济南",
    "南京",
    "合肥",
    "杭州",
    "南昌",
    "福州",
    "郑州",
    "武汉",
    "长沙",
    "广州",
    "南宁",
    "西安",
    "银川",
    "兰州",
    "西宁",
    "乌鲁木齐",
    "成都",
    "贵阳",
    "昆明",
    "拉萨",
    "海口",
  ];

  let randomCount = 300;

  // 构造数据
  while (randomCount--) {
    let cityCenter = getCityCenter(citys[Math.floor(Math.random() * citys.length)]);
    data.push({
      geometry: {
        type: "Point",
        coordinates: [
          cityCenter.lng - 2 + Math.random() * 4,
          cityCenter.lat - 2 + Math.random() * 4,
        ],
      },
      properties: {
        count: Math.random() * 100,
      },
    });
  }

  let view = new mapvgl.View({
    map: map?.raw,
  });

  let pointLayer = new mapvgl.PointLayer({
    blend: "lighter",
    size: 15,
    color: "rgba(102, 0, 204, 0.6)",
  });

  view.addLayer(pointLayer);
  pointLayer.setData(data);
}

function getCityCenter(city) {
  const centers = {
    北京: [116.4074, 39.9042],
    天津: [117.1902, 39.1256],
    上海: [121.4737, 31.2304],
    重庆: [106.5516, 29.563],
    石家庄: [114.5149, 38.0428],
    太原: [112.5489, 37.8706],
    呼和浩特: [111.7492, 40.8426],
    哈尔滨: [126.6424, 45.756],
    长春: [125.3235, 43.8171],
    沈阳: [123.4315, 41.8057],
    济南: [117.1201, 36.6512],
    南京: [118.7969, 32.0603],
    合肥: [117.2272, 31.8206],
    杭州: [120.1551, 30.2741],
    南昌: [115.8582, 28.6829],
    福州: [119.2965, 26.0745],
    郑州: [113.6254, 34.7466],
    武汉: [114.3055, 30.5928],
    长沙: [112.9388, 28.2282],
    广州: [113.2644, 23.1291],
    南宁: [108.3669, 22.817],
    西安: [108.9398, 34.3416],
    银川: [106.2309, 38.4872],
    兰州: [103.8343, 36.0611],
    西宁: [101.7782, 36.6171],
    乌鲁木齐: [87.6168, 43.8256],
    成都: [104.0665, 30.5723],
    贵阳: [106.6302, 26.6477],
    昆明: [102.8329, 24.8801],
    拉萨: [91.1409, 29.6456],
    海口: [110.3312, 20.0311],
  };
  const [lng, lat] = centers[city];
  return { lng, lat };
}
</script>
