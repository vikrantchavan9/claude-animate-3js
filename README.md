# Vertical 3D Cartoon Reels Generator

A code-driven animation pipeline for creating vertical 3D reels (1080x1920, 30 FPS) using Three.js, Puppeteer, and FFmpeg.

## Project Structure

```
video-1/
├── assets/         # 3D models (GLTF/GLB), textures, images
├── audio/          # Background music & voiceovers
├── sfx/            # Sound effects
├── build/          # Rendered MP4 videos and preview still PNGs
│   ├── output.mp4  # Generated 2-second vertical test reel
│   ├── still_0_000s.png
│   ├── still_0_500s.png
│   └── still_1_000s.png
├── comp.html       # WebGL composition scene with window.renderFrame(t)
├── package.json    # Project metadata and dependencies
└── render.js       # Puppeteer & FFmpeg headless rendering pipeline
```

## How It Works

1. **`comp.html`**: Sets up the Three.js 3D scene (1080x1920) and exposes `window.renderFrame(t)`. The animation state is strictly driven by the timestamp parameter `t` in seconds, ensuring deterministic, frame-perfect rendering.
2. **`render.js`**:
   - Launches headless Google Chrome via `puppeteer-core`.
   - Starts an internal static HTTP server to serve ES modules and assets without CORS restrictions.
   - For every frame at 30 FPS, evaluates `window.renderFrame(t)`.
   - Takes a PNG screenshot and streams it directly to `ffmpeg` via standard input pipe.
   - Outputs a high-quality vertical H.264 MP4 video (`build/output.mp4`).

## Usage

### 1. Full Video Render
Render full video (default 2 seconds at 30 FPS = 60 frames):
```bash
node render.js
```
Or customize duration, frame rate, and output file:
```bash
node render.js --duration 5 --fps 30 --output build/my_reel.mp4
```

### 2. Stills Mode (Preview Frames)
Render specific still frames without creating a video:
```bash
# Render frames at t=0s, t=0.5s, t=1.0s, t=1.5s
node render.js --stills 0,0.5,1.0,1.5
```
Or via npm script:
```bash
npm run stills
```
Preview PNGs are saved to `build/still_<timestamp>s.png`.

## Installed Tools & Dependencies
- **Three.js**: `^0.183.2`
- **puppeteer-core**: `^24.40.0`
- **Google Chrome**: `157.0.8103.39` (`C:\Program Files\Google\Chrome\Application\chrome.exe`)
- **FFmpeg**: `9.0.1` (`Gyan.FFmpeg.Essentials`)

