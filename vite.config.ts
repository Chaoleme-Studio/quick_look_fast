import { defineConfig } from 'vite';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import chartFix from './patch/flyfish-pptx-chart-fix.cjs';
import rowFix from './patch/flyfish-xlsx-row-fix.cjs';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: './',
  plugins: [
    { name: 'slowlook-pptx-chart-labels', enforce: 'pre', transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/@file-viewer/pptx/dist/chart-config.js')) return chartFix.patchChartConfig(code);
    } },
    { name: 'quicklook-xlsx-row-heights', enforce: 'pre', transform(code, id) {
      const file = id.replaceAll('\\', '/');
      if (file.endsWith('/@file-viewer/renderer-spreadsheet/dist/spreadsheet.js')) return rowFix.patchSpreadsheet(code);
      if (file.endsWith('/@file-viewer/renderer-spreadsheet/dist/spreadsheet/autoRowHeight.js')) return rowFix.patchAutoRowHeight(code);
    } },
    fileViewerRenderers({ copyAssets: true, inject: false, chunkStrategy: 'none' }),
  ],
  build: {
    outDir: '../build/dist',
    emptyOutDir: true,
    target: 'chrome130',
  },
});
