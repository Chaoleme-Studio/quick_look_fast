import { defineConfig } from 'vite';
import { fileViewerRenderers } from '@file-viewer/vite-plugin';
import chartFix from './patch/flyfish-pptx-chart-fix.cjs';
import rowFix from './patch/flyfish-xlsx-row-fix.cjs';
import zoomFix from './patch/flyfish-xlsx-zoom-fix.cjs';
import docxOutline from './patch/flyfish-docx-outline.cjs';

let patchedDocxOutline = false;

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  base: './',
  plugins: [
    { name: 'quicklook-docx-outline', enforce: 'pre', transform(code, id) {
      if (/\/@file-viewer\/docx\/dist\/docx-preview\.(?:mjs|js)$/.test(id.replaceAll('\\', '/'))) {
        patchedDocxOutline = true;
        return docxOutline.patchDocxOutline(code);
      }
    }, generateBundle() {
      if (!patchedDocxOutline) throw new Error('Flyfish DOCX renderer was not found; document navigation cannot be built.');
    } },
    { name: 'slowlook-pptx-chart-labels', enforce: 'pre', transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/@file-viewer/pptx/dist/chart-config.js')) return chartFix.patchChartConfig(code);
    } },
    { name: 'quicklook-xlsx-row-heights', enforce: 'pre', transform(code, id) {
      const file = id.replaceAll('\\', '/');
      if (file.endsWith('/@file-viewer/renderer-spreadsheet/dist/spreadsheet.js')) return zoomFix.patchSpreadsheet(rowFix.patchSpreadsheet(code));
      if (file.endsWith('/@file-viewer/renderer-spreadsheet/dist/spreadsheet/autoRowHeight.js')) return rowFix.patchAutoRowHeight(code);
      if (file.endsWith('/@file-viewer/renderer-spreadsheet/dist/spreadsheet/view.js')) return zoomFix.patchView(code);
    } },
    fileViewerRenderers({ copyAssets: true, inject: false, chunkStrategy: 'none' }),
  ],
  build: {
    outDir: '../build/dist',
    emptyOutDir: true,
    target: 'chrome130',
  },
});
