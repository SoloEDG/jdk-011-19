<script setup lang="ts">
import { computed } from "vue";
import { Scan, Trash2, PaintBucket, X } from "lucide-vue-next";
import type { Workspace } from "../../../shared/document";
import { regionSummary } from "../lib/summary";
import { dimensions } from "../lib/region";
import { regionTouchesUnloaded } from "../model/selection";
const props = defineProps<{ state: Workspace }>();
defineEmits<{ fill: []; remove: []; clear: []; start: [] }>();
const stats = computed(() => {
  void props.state.doc.revision;
  void props.state.loadedChunks;
  return regionSummary(props.state);
});
const unloaded = computed(() => {
  void props.state.loadedChunks;
  return regionTouchesUnloaded(props.state);
});
</script>
<template>
  <section class="panel">
    <div class="section-title">
      <h2>区域选择</h2>
      <Scan :size="17" />
    </div>
    <div v-if="state.region" class="selection-info">
      <b
        >{{ dimensions(state.region).x }} × {{ dimensions(state.region).y }} ×
        {{ dimensions(state.region).z }}</b
      ><span
        >{{ stats.complete ? "" : "约 "
        }}{{ stats.occupied.toLocaleString() }} 个方块 ·
        {{ stats.complete ? stats.empty.toLocaleString() : "估算" }} 个空位</span
      >
      <span v-if="!stats.complete || unloaded" class="muted small"
        >选区跨越未加载区块，确认前会依据世界数据完整校验</span
      >
      <div class="row">
        <button class="soft" @click="$emit('fill')">
          <PaintBucket :size="14" />填充</button
        ><button class="soft danger" @click="$emit('remove')">
          <Trash2 :size="14" />拆除</button
        ><button class="icon-btn" @click="$emit('clear')">
          <X :size="14" />
        </button>
      </div>
    </div>
    <div v-else class="selection-empty">
      <div class="dashed-cube">⌗</div>
      <p>让建造更高效</p>
      <small>选中两个角点，批量编辑区域</small
      ><button class="soft full" @click="$emit('start')">
        开始选择 <span>R</span>
      </button>
    </div>
  </section>
</template>
