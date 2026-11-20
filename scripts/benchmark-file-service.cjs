// Synthetic local-I/O benchmark. It does not measure Electron/Chromium rendering.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { startFileServer } = require('../build/dist-electron/files/file-server.js');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slowlook-benchmark-'));
  const file = path.join(directory, 'synthetic.bin');
  const size = 128 * 1024 * 1024;
  const fd = fs.openSync(file, 'wx');
  try { fs.ftruncateSync(fd, size); } finally { fs.closeSync(fd); }
  const active = { token: 'benchmark-token', path: file };
  const { server, origin } = await startFileServer(() => active, () => {});
  const url = `${origin}/preview/${active.token}/synthetic.bin`;
  try {
    const durations = [];
    for (let i = 0; i < 35; i += 1) {
      const start = size - (1 + (i % 4)) * 1024 * 1024;
      const began = performance.now();
      const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + 1024 * 1024 - 1}` } });
      if (response.status !== 206 || (await response.arrayBuffer()).byteLength !== 1024 * 1024) throw new Error('Unexpected range response');
      if (i >= 5) durations.push(performance.now() - began);
    }
    durations.sort((a, b) => a - b);
    const rangeP95 = durations[Math.ceil(durations.length * 0.95) - 1];

    if (global.gc) global.gc();
    let baseline = process.memoryUsage();
    let peakRss = baseline.rss;
    let sampling = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
    let began = performance.now();
    let total = 0;
    const streamResponse = await fetch(url);
    for await (const chunk of streamResponse.body) total += chunk.byteLength;
    let elapsed = performance.now() - began;
    clearInterval(sampling);
    if (total !== size) throw new Error('Full stream did not match file size');
    const streamed = { ms: elapsed, mibPerSecond: size / 1048576 / (elapsed / 1000), rssIncreaseMiB: (peakRss - baseline.rss) / 1048576 };

    if (global.gc) global.gc();
    baseline = process.memoryUsage();
    peakRss = baseline.rss;
    sampling = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
    began = performance.now();
    const bufferResponse = await fetch(url);
    const blob = await bufferResponse.blob();
    const buffer = await blob.arrayBuffer();
    elapsed = performance.now() - began;
    const bufferedMemory = process.memoryUsage();
    peakRss = Math.max(peakRss, bufferedMemory.rss);
    clearInterval(sampling);
    if (buffer.byteLength !== size) throw new Error('Whole-buffer size did not match file size');
    const buffered = {
      ms: elapsed,
      rssIncreaseMiB: (peakRss - baseline.rss) / 1048576,
      arrayBuffersIncreaseMiB: (bufferedMemory.arrayBuffers - baseline.arrayBuffers) / 1048576,
    };
    console.log(JSON.stringify({
      fileSizeMiB: size / 1048576,
      scenario: 'synthetic zero-filled file; warmed local filesystem; Node server and client share one process',
      range: { requestMiB: 1, samples: durations.length, p95Ms: rangeP95 },
      streamed, buffered,
    }, null, 2));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.unlinkSync(file);
    fs.rmdirSync(directory);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
