import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'LectureInk',
    description: 'AI notes, code and Excalidraw diagrams from any lecture video, saved to your markdown vault.',
    permissions: ['storage', 'unlimitedStorage', 'tabs', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open LectureInk' },
  },
});
