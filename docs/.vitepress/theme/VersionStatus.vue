<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useData, type DefaultTheme } from 'vitepress';

import type { TrinityThemeConfig, VersionsManifest } from '../site';

const { theme } = useData<DefaultTheme.Config & TrinityThemeConfig>();
const selected = ref(theme.value.version.channel);
const manifest = ref<VersionsManifest>({ latest: null, versions: [] });

const options = computed(() => {
  const values = ['next'];
  if (manifest.value.latest !== null) {
    values.push('latest');
  }
  values.push(...manifest.value.versions);
  if (!values.includes(theme.value.version.channel)) {
    values.push(theme.value.version.channel);
  }
  return [...new Set(values)];
});

const banner = computed(() => {
  if (theme.value.version.channel === 'next') {
    return 'You are viewing unreleased documentation from master.';
  }
  if (theme.value.version.channel === 'latest') {
    return null;
  }
  return `You are viewing ${theme.value.version.label}. Check Latest before upgrading.`;
});

onMounted(async () => {
  try {
    const response = await fetch(theme.value.version.manifestUrl, {
      credentials: 'omit',
    });
    if (response.ok) {
      manifest.value = (await response.json()) as VersionsManifest;
    }
  } catch {
    // Local preview and offline copies intentionally work without a manifest.
  }
});

function selectVersion(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  const currentBase = `${theme.value.version.projectBase}${theme.value.version.channel}/`;
  const relativePath = window.location.pathname.startsWith(currentBase)
    ? window.location.pathname.slice(currentBase.length)
    : '';
  window.location.assign(
    `${theme.value.version.projectBase}${target.value}/${relativePath}${window.location.search}${window.location.hash}`,
  );
}
</script>

<template>
  <div
    class="trinity-version-status"
    :class="{ 'has-banner': banner !== null }"
  >
    <p v-if="banner" role="status">{{ banner }}</p>
    <label>
      <span>Documentation version</span>
      <select v-model="selected" @change="selectVersion">
        <option v-for="option in options" :key="option" :value="option">
          {{
            option === 'next' ? 'Next' : option === 'latest' ? 'Latest' : option
          }}
        </option>
      </select>
    </label>
  </div>
</template>
