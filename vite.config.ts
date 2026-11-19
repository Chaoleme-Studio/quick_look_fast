import { defineConfig } from 'vite';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import chartFix from './scripts/flyfish-pptx-chart-fix.cjs';

export default defineConfig({
  base: './',
  plugins: [
    { name: 'slowlook-pptx-chart-labels', enforce: 'pre', transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/@file-viewer/pptx/dist/chart-config.js')) return chartFix.patchChartConfig(code);
    } },
    fileViewerRenderers({ copyAssets: true, inject: false, chunkStrategy: 'none' }),
  ],
  build: {
    target: 'chrome130',
  },
});
