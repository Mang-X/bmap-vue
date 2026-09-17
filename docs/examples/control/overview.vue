<template>
  <BMap v-bind="$attrs">
    <BOverview :is-open="true" :size="{ x: 180, y: 180 }" />
  </BMap>
</template>
