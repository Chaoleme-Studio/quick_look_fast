const MAX_WAVEFORM_BYTES = 6 * 1024 * 1024;
const MAX_WAVEFORM_SECONDS = 90;
const BAR_COUNT = 96;

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A seek control with bounded optional analysis; playback itself remains streaming. */
export function mountAudioWaveform(player: HTMLMediaElement, file: { url: string; size: number }): { element: HTMLElement; dispose(): void } {
  const container = document.createElement('div');
  container.className = 'audio-waveform-control';
  const track = document.createElement('div');
  track.className = 'audio-waveform-track';
  const bars = document.createElement('div');
  bars.className = 'audio-waveform-bars';
  bars.setAttribute('aria-hidden', 'true');
  const elements = Array.from({ length: BAR_COUNT }, (_, index) => {
    const bar = document.createElement('span');
    // Clearly labelled as illustrative until the bounded decode succeeds.
    bar.style.height = `${12 + 75 * Math.abs(Math.sin(index * .27) * Math.cos(index * .11))}%`;
    bars.append(bar);
    return bar;
  });
  const seek = document.createElement('input');
  seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '0.01'; seek.value = '0'; seek.disabled = true;
  seek.className = 'audio-waveform-seek';
  seek.setAttribute('aria-label', '音频播放进度');
  const meta = document.createElement('div');
  meta.className = 'audio-waveform-meta';
  const elapsed = document.createElement('span');
  const caption = document.createElement('span');
  const duration = document.createElement('span');
  caption.textContent = '波形示意';
  meta.append(elapsed, caption, duration);
  track.append(bars, seek);
  container.append(track, meta);

  const abort = new AbortController();
  let disposed = false;
  let analyzing = false;
  let context: AudioContext | undefined;
  const update = (): void => {
    const total = player.duration;
    const valid = Number.isFinite(total) && total > 0;
    const position = Number.isFinite(player.currentTime) ? Math.max(0, player.currentTime) : 0;
    seek.disabled = !valid;
    seek.max = valid ? String(total) : '0';
    seek.value = valid ? String(Math.min(position, total)) : '0';
    seek.setAttribute('aria-valuetext', `${formatTime(position)} / ${formatTime(total)}`);
    elapsed.textContent = formatTime(position);
    duration.textContent = formatTime(total);
    const progress = valid ? Math.min(1, position / total) : 0;
    elements.forEach((bar, index) => bar.classList.toggle('is-played', (index + .5) / BAR_COUNT <= progress));
  };
  const onSeek = (): void => {
    if (!seek.disabled && Number.isFinite(Number(seek.value))) player.currentTime = Number(seek.value);
    update();
  };
  const analyze = async (): Promise<void> => {
    if (disposed || analyzing || !Number.isFinite(player.duration) || player.duration <= 0 ||
        player.duration > MAX_WAVEFORM_SECONDS || file.size <= 0 || file.size > MAX_WAVEFORM_BYTES || !window.AudioContext) return;
    analyzing = true;
    caption.textContent = '正在分析波形';
    try {
      const response = await fetch(file.url, { signal: abort.signal, headers: { Range: `bytes=0-${file.size - 1}` } });
      if (!response.ok || !response.body) throw new Error('Audio read failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.byteLength;
          if (length > MAX_WAVEFORM_BYTES) { await reader.cancel(); throw new Error('Audio changed during analysis'); }
          chunks.push(result.value);
        }
      } finally { reader.releaseLock(); }
      if (disposed) return;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      // The envelope does not need playback quality; a lower output rate keeps
      // the decoded AudioBuffer much smaller than the normal audio stream.
      context = new window.AudioContext({ sampleRate: 8000 });
      const buffer = await context.decodeAudioData(bytes.buffer);
      if (disposed) return;
      const peaks = Array.from({ length: BAR_COUNT }, () => 0);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const samples = buffer.getChannelData(channel);
        for (let bar = 0; bar < BAR_COUNT; bar += 1) {
          const start = Math.floor(samples.length * bar / BAR_COUNT);
          const end = Math.floor(samples.length * (bar + 1) / BAR_COUNT);
          const stride = Math.max(1, Math.floor((end - start) / 2048));
          for (let i = start; i < end; i += stride) peaks[bar] = Math.max(peaks[bar], Math.abs(samples[i]));
        }
      }
      const peak = Math.max(...peaks, .001);
      elements.forEach((bar, index) => { bar.style.height = `${Math.max(8, Math.min(100, peaks[index] / peak * 100))}%`; });
      caption.textContent = '音频波形';
    } catch {
      if (!disposed) caption.textContent = '波形示意';
    } finally {
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
      context = undefined;
    }
  };
  const onMetadata = (): void => { update(); void analyze(); };
  seek.addEventListener('input', onSeek);
  for (const event of ['timeupdate', 'durationchange', 'seeking', 'ended', 'emptied']) player.addEventListener(event, update);
  player.addEventListener('loadedmetadata', onMetadata);
  update();
  if (player.readyState >= 1) onMetadata();
  return { element: container, dispose: () => {
    disposed = true;
    abort.abort();
    seek.removeEventListener('input', onSeek);
    for (const event of ['timeupdate', 'durationchange', 'seeking', 'ended', 'emptied']) player.removeEventListener(event, update);
    player.removeEventListener('loadedmetadata', onMetadata);
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  } };
}
