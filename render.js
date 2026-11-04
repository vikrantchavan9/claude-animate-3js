import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project directories
const BUILD_DIR = path.resolve(__dirname, 'build');
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

/**
 * Locate Chrome / Chromium executable on the system.
 */
function findChromeExecutable() {
  const envPath = process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    // Standard Google Chrome locations
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    // Microsoft Edge (Chromium fallback)
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

/**
 * Locate FFmpeg executable on the system.
 */
function findFFmpegExecutable() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  // Check PATH first
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, 'ffmpeg.exe');
    if (fs.existsSync(candidate)) return candidate;
    const candidateNoExt = path.join(dir, 'ffmpeg');
    if (fs.existsSync(candidateNoExt)) return candidateNoExt;
  }

  // Check WinGet Packages directory
  const localAppData = process.env.LOCALAPPDATA || '';
  const wingetPkgDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetPkgDir)) {
    const entries = fs.readdirSync(wingetPkgDir);
    for (const entry of entries) {
      if (entry.toLowerCase().includes('ffmpeg')) {
        const fullDirPath = path.join(wingetPkgDir, entry);
        // Look recursively for bin/ffmpeg.exe
        const queue = [fullDirPath];
        while (queue.length > 0) {
          const curr = queue.shift();
          try {
            const files = fs.readdirSync(curr, { withFileTypes: true });
            for (const f of files) {
              const fullSub = path.join(curr, f.name);
              if (f.isDirectory()) {
                queue.push(fullSub);
              } else if (f.name.toLowerCase() === 'ffmpeg.exe') {
                return fullSub;
              }
            }
          } catch {
            // skip inaccessible dirs
          }
        }
      }
    }
  }

  return 'ffmpeg';
}

/**
 * Minimal static file server to serve comp.html, assets, and node_modules seamlessly.
 */
function startStaticServer(rootDir) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
  };

  const server = http.createServer((req, res) => {
    let reqUrl = decodeURI(req.url.split('?')[0]);
    if (reqUrl === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (reqUrl === '/') reqUrl = '/comp.html';

    const safePath = path.normalize(path.join(rootDir, reqUrl));
    if (!safePath.startsWith(rootDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found: ' + reqUrl);
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(safePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

/**
 * Parse command-line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    fps: 30,
    duration: 12.0,
    width: 1080,
    height: 1920,
    output: path.join(BUILD_DIR, 'output.mp4'),
    stills: null, // array of timestamps in seconds if passed
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fps' && args[i + 1]) {
      options.fps = parseInt(args[++i], 10);
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseFloat(args[++i]);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = path.resolve(args[++i]);
    } else if (arg.startsWith('--stills=')) {
      options.stills = arg
        .slice('--stills='.length)
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
    } else if (arg === '--stills' || arg === '--still') {
      const next = args[++i];
      if (next) {
        options.stills = next
          .split(',')
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !isNaN(n));
      }
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  console.log('='.repeat(60));
  console.log('  Vertical 3D Cartoon Reel Renderer');
  console.log('='.repeat(60));

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error('Error: Could not find Google Chrome or Chromium executable.');
    console.error('Please install Google Chrome or set CHROME_PATH environment variable.');
    process.exit(1);
  }
  console.log(`[Chrome] Using executable: ${chromePath}`);

  // Start internal static server for seamless asset and ES module loading
  const { server, baseUrl } = await startStaticServer(__dirname);
  console.log(`[Server] Local server running at ${baseUrl}`);

  console.log(`[Puppeteer] Launching headless browser (${options.width}x${options.height})...`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'video-1-render-')),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--disable-web-security',
      '--hide-scrollbars',
      `--window-size=${options.width},${options.height}`,
    ],
    defaultViewport: {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
    },
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: options.width,
    height: options.height,
    deviceScaleFactor: 1,
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error(`[Browser Error]:`, msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.error(`[Browser Page Error]:`, err);
  });

  console.log(`[Puppeteer] Loading comp.html...`);
  await page.goto(`${baseUrl}/comp.html`, { waitUntil: 'networkidle0' });

  // Wait for window.renderFrame to be registered
  await page.waitForFunction(() => typeof window.renderFrame === 'function', { timeout: 15000 });
  await page.evaluate(() => window.ready);
  console.log('[Puppeteer] window.renderFrame(t) is ready.');

  // MODE 1: Stills Mode
  if (options.stills && options.stills.length > 0) {
    console.log(`\n[Mode] STILLS MODE - Rendering ${options.stills.length} frame(s)...`);
    const stillOutputs = [];

    for (const t of options.stills) {
      await page.evaluate((timestamp) => window.renderFrame(timestamp), t);
      const filename = `still_${t.toFixed(3).replace('.', '_')}s.png`;
      const outPath = path.join(BUILD_DIR, filename);
      await page.screenshot({ path: outPath, type: 'png' });
      console.log(`  -> Saved still frame at t=${t}s: ${outPath}`);
      stillOutputs.push(outPath);
    }

    await browser.close();
    server.close();
    console.log(`\nStills render complete! Saved ${stillOutputs.length} images in ${BUILD_DIR}`);
    return;
  }

  // MODE 2: Full Video Render Mode (Piping frames to FFmpeg)
  const ffmpegPath = findFFmpegExecutable();
  console.log(`[FFmpeg] Using executable: ${ffmpegPath}`);

  const totalFrames = Math.round(options.duration * options.fps);
  console.log(`\n[Mode] VIDEO MODE`);
  console.log(`  Resolution: ${options.width}x${options.height}`);
  console.log(`  Framerate:  ${options.fps} fps`);
  console.log(`  Duration:   ${options.duration}s (${totalFrames} frames)`);
  console.log(`  Output:     ${options.output}\n`);

  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(options.fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-movflags', '+faststart',
    options.output,
  ];

  const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  let ffmpegError = null;
  ffmpeg.on('error', (err) => {
    ffmpegError = err;
    console.error('[FFmpeg Error]:', err);
  });

  const startTime = Date.now();

  for (let frame = 0; frame < totalFrames; frame++) {
    if (ffmpegError) {
      throw new Error(`FFmpeg process encountered an error: ${ffmpegError.message}`);
    }

    const t = frame / options.fps;
    await page.evaluate((timestamp) => window.renderFrame(timestamp), t);
    const screenshotBuffer = await page.screenshot({ type: 'png' });

    // Handle backpressure when writing to stdin
    const canContinue = ffmpeg.stdin.write(screenshotBuffer);
    if (!canContinue) {
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }

    const percent = (((frame + 1) / totalFrames) * 100).toFixed(1);
    const progress = `[Frame ${frame + 1}/${totalFrames}] t=${t.toFixed(3)}s (${percent}%)`;
    process.stdout.write(`\r${progress}`);
  }

  console.log('\nAll frames captured. Finalizing video encoding...');
  ffmpeg.stdin.end();

  await new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n[Done] Render completed successfully in ${elapsed}s!`);
  console.log(`[Output MP4]: ${options.output}`);

  await browser.close();
  server.close();
}

main().catch((err) => {
  console.error('\nRender failed:', err);
  process.exit(1);
});
