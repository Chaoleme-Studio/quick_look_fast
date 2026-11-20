import { formatDimensions, readPhotoExif, type ImageDimensions } from '../preview/image/image-metadata.ts';

export interface PreviewFile {
  url: string;
  name: string;
  size: number;
  path?: string;
  modifiedAt?: string;
  createdAt?: string;
  shortcut?: { target?: string; description?: string };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function infoRow(list: HTMLElement, label: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value instanceof Date ? value.toLocaleString('zh-CN') : String(value);
  list.append(term, detail);
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toLocaleString('zh-CN');
}

export function fileInfoDetails(file: PreviewFile, imageSize?: ImageDimensions | 'unknown'): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'metadata-list';
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : '';
  infoRow(list, '名称', file.name);
  infoRow(list, '类型', extension ? `${extension} 文件` : '文件');
  infoRow(list, '大小', `${formatSize(file.size)} · ${file.size.toLocaleString()} 字节`);
  if (imageSize) {
    const label = imageSize !== 'unknown' && imageSize.unit === 'viewBox' ? '矢量视框' : '图像尺寸';
    infoRow(list, label, imageSize === 'unknown' ? '未读取到' : formatDimensions(imageSize));
  }
  infoRow(list, '修改时间', formatDate(file.modifiedAt));
  infoRow(list, '创建时间', formatDate(file.createdAt));
  infoRow(list, '位置', file.path);
  infoRow(list, '快捷方式目标', file.shortcut?.target);
  infoRow(list, '说明', file.shortcut?.description);
  return list;
}

export async function showPhotoExif(
  container: HTMLElement, file: PreviewFile, signal: AbortSignal, reportSize: (size: ImageDimensions) => void,
): Promise<void> {
  const section = document.createElement('section');
  section.className = 'exif-section';
  const heading = document.createElement('h3');
  heading.textContent = '照片信息 · EXIF';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = '正在读取照片信息…';
  section.append(heading, status);
  container.append(section);
  try {
    const result = await readPhotoExif(file, signal);
    if (signal.aborted || section.parentNode !== container) return;
    if (result.dimensions) reportSize(result.dimensions);
    const list = document.createElement('dl');
    list.className = 'metadata-list';
    for (const [label, value] of result.fields) infoRow(list, label, value);
    if (list.childElementCount) {
      status.replaceWith(list);
      return;
    }
    status.textContent = {
      found: '已读取图像尺寸，未找到相机或拍摄参数。',
      missing: '这张图片没有可显示的 EXIF 信息。',
      limited: '在读取范围内未找到可显示的 EXIF 信息。',
      unreadable: '无法读取 EXIF，文件可能损坏、格式不兼容或元数据超出读取范围。',
      unsupported: '此格式暂不支持 EXIF 读取。',
    }[result.status];
  } catch {
    if (!signal.aborted) status.textContent = '无法读取 EXIF。';
  }
}
