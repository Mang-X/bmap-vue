<template>
  <BPanorama
    v-bind="$attrs"
    style="width: 100%; height: 480px"
    :point="{ lng: 116.404, lat: 39.915 }"
    :pov="{ heading: 0, pitch: -10 }"
  >
    <BPanoramaLabel content="天安门" :position="{ lng: 116.404, lat: 39.915 }" :altitude="20" />
  </BPanorama>
</template>
