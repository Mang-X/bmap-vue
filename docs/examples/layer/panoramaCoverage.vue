<template>
  <!-- ak 由文档站的应用级装配提供（createBMapPlugin({ ak })），示例不携带密钥 -->
  <BMap v-bind="$attrs" enableScrollWheelZoom>
    <BPanoramaControl />
    <BPanoramaCoverageLayer />
  </BMap>
</template>
