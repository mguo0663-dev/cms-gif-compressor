/**
 * FFmpeg-equivalent preprocessing in the browser:
 * decode → fps resample → scale (high-quality smoothing) → ImageData frames
 */

const MAX_FRAMES = 400;
const MAX_PIXELS = 1920 * 1080;

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isGifFile(file) {
  const type = file.type.toLowerCase();
  return type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
}

export function isVideoFile(file) {
  const type = file.type.toLowerCase();
  return (
    type.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v)$/i.test(file.name)
  );
}

/** @param targetWidth 目标宽度；≥原宽时保持原尺寸 */
function computeOutputSize(srcW, srcH, targetWidth) {
  const tw = Math.round(targetWidth);
  if (!tw || tw >= srcW) return { width: srcW, height: srcH };
  const height = Math.round((srcH * tw) / srcW);
  return { width: tw, height: Math.max(1, height) };
}

export function targetWidthFromPercent(srcW, sizePercent) {
  return Math.max(1, Math.round((srcW * sizePercent) / 100));
}

/** 读取 GIF 逻辑画布尺寸（Logical Screen Descriptor），避免 ImageDecoder 首帧尺寸误判 */
export async function probeGifLogicalSize(buffer) {
  const { parseGIF } = await import(
    "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm"
  );
  const gif = parseGIF(buffer);
  return { width: gif.lsd.width, height: gif.lsd.height };
}

function drawScaledFrame(ctx, image, outW, outH) {
  ctx.clearRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

const VIDEO_CAPTURE_HOST_ID = "gif-video-capture-host";

/** 未挂载 DOM 的 video 在部分浏览器（尤其 Retina）上抽帧只有约一半分辨率 */
function mountVideoForCapture(video, width, height) {
  document.getElementById(VIDEO_CAPTURE_HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = VIDEO_CAPTURE_HOST_ID;
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-9999px",
    top: "-9999px",
    width: `${width}px`,
    height: `${height}px`,
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
    overflow: "hidden",
    clipPath: "inset(100%)",
  });

  video.width = width;
  video.height = height;
  video.style.width = `${width}px`;
  video.style.height = `${height}px`;
  video.style.opacity = "0";
  host.appendChild(video);
  document.body.appendChild(host);
  return host;
}

function unmountVideoCapture(host) {
  host?.remove();
  document.getElementById(VIDEO_CAPTURE_HOST_ID)?.remove();
}

async function waitForVideoFrameReady() {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function assertFrameDimensions(imageData, outW, outH, srcW, srcH) {
  const expectedBytes = outW * outH * 4;
  if (imageData.width !== outW || imageData.height !== outH) {
    throw new Error(
      `抽帧尺寸异常：得到 ${imageData.width}×${imageData.height}，需要 ${outW}×${outH}。请换用 Chrome 或刷新后重试。`
    );
  }
  if (imageData.data.length !== expectedBytes) {
    throw new Error(
      `抽帧像素数据不完整（${imageData.data.length} 字节，需要 ${expectedBytes}）。请换用 Chrome 桌面版后重试。`
    );
  }
  if (outW >= srcW && imageData.width < srcW * 0.85) {
    throw new Error(
      `抽帧分辨率不足（${imageData.width}×${imageData.height}），无法输出原尺寸 ${srcW}×${srcH}。请换用 Chrome 桌面版后重试。`
    );
  }
}

/**
 * 抽帧并强制输出 outW×outH。
 * 部分浏览器解码只有约一半像素，需先读 natural 尺寸再经 canvas 放大。
 */
async function captureFrameFromVideo(ctx, video, outW, outH, srcW) {
  if (video.paused) {
    await video.play().catch(() => {});
  }

  const drawToOutput = (source) => {
    ctx.clearRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, outW, outH);
    return ctx.getImageData(0, 0, outW, outH);
  };

  try {
    if (typeof VideoFrame !== "undefined") {
      const vf = new VideoFrame(video, { timestamp: (video.currentTime || 0) * 1e6 });
      const bitmap = await createImageBitmap(vf, {
        resizeWidth: outW,
        resizeHeight: outH,
        resizeQuality: "high",
      });
      vf.close();
      const imageData = drawToOutput(bitmap);
      bitmap.close();
      return imageData;
    }
  } catch {
    /* 回退 */
  }

  if (typeof createImageBitmap === "function") {
    const natural = await createImageBitmap(video);
    const halfRes = srcW > 0 && natural.width < srcW * 0.9;
    if (halfRes || natural.width !== outW || natural.height !== outH) {
      const imageData = drawToOutput(natural);
      natural.close();
      return imageData;
    }
    natural.close();
    const bitmap = await createImageBitmap(video, {
      resizeWidth: outW,
      resizeHeight: outH,
      resizeQuality: "high",
    });
    const imageData = drawToOutput(bitmap);
    bitmap.close();
    return imageData;
  }

  return drawScaledFrame(ctx, video, outW, outH);
}

function resampleByFps(frames, targetFps) {
  if (!frames.length) return [];
  const totalMs = frames.reduce((sum, f) => sum + f.delayMs, 0);
  if (totalMs <= 0) return frames.map((f) => f.imageData);

  const interval = 1000 / targetFps;
  const out = [];
  let t = 0;
  let idx = 0;
  let acc = frames[0].delayMs;

  while (t < totalMs && out.length < MAX_FRAMES) {
    while (idx < frames.length - 1 && t >= acc) {
      idx++;
      acc += frames[idx].delayMs;
    }
    out.push(frames[idx].imageData);
    t += interval;
  }

  if (!out.length) out.push(frames[0].imageData);
  return out;
}

export async function probeMediaSize(file) {
  if (isGifFile(file)) {
    const buffer = await file.arrayBuffer();
    return probeGifLogicalSize(buffer);
  }
  if (isVideoFile(file)) {
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.style.display = "none";
      video.style.position = "fixed";
      video.style.left = "-9999px";
      video.style.top = "-9999px";
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("无法读取视频尺寸"));
      });
      return { width: video.videoWidth, height: video.videoHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  throw new Error("无法识别文件尺寸");
}

async function decodeGifWithImageDecoder(buffer, targetWidth, onProgress) {
  if (typeof ImageDecoder === "undefined") {
    return decodeGifWithGifuct(buffer, targetWidth, onProgress);
  }

  const { width: srcW, height: srcH } = await probeGifLogicalSize(buffer);

  const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
  const { image } = await decoder.decode();
  const track = decoder.tracks.selectedTrack;
  const frameCount = track.frameCount;
  const { width: outW, height: outH } = computeOutputSize(srcW, srcH, targetWidth);

  if (outW * outH > MAX_PIXELS) {
    throw new Error(`输出分辨率过大（${outW}×${outH}），请降低图像尺寸`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const rawFrames = [];
  for (let i = 0; i < frameCount; i++) {
    const { image: frameImg } = await decoder.decode({ frameIndex: i });
    let delayMs = 100;
    if (typeof track.frameDuration === "function") {
      delayMs = Math.max(10, track.frameDuration(i) / 1000);
    }
    rawFrames.push({
      imageData: drawScaledFrame(ctx, frameImg, outW, outH),
      delayMs,
    });
    frameImg.close();
    onProgress?.(0.1 + (0.5 * (i + 1)) / frameCount);
    if (rawFrames.length >= MAX_FRAMES) break;
  }

  image.close();
  decoder.close();
  return { frames: rawFrames, width: outW, height: outH };
}

async function decodeGifWithGifuct(buffer, targetWidth, onProgress) {
  const { parseGIF, decompressFrames } = await import(
    "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm"
  );
  const gif = parseGIF(buffer);
  const patches = decompressFrames(gif, true);
  const srcW = gif.lsd.width;
  const srcH = gif.lsd.height;
  const { width: outW, height: outH } = computeOutputSize(srcW, srcH, targetWidth);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const full = document.createElement("canvas");
  full.width = srcW;
  full.height = srcH;
  const fullCtx = full.getContext("2d");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const rawFrames = [];
  for (let i = 0; i < patches.length && i < MAX_FRAMES; i++) {
    const patch = patches[i];
    const temp = document.createElement("canvas");
    temp.width = patch.dims.width;
    temp.height = patch.dims.height;
    const tctx = temp.getContext("2d");
    const imageData = tctx.createImageData(patch.dims.width, patch.dims.height);
    imageData.data.set(patch.patch);
    tctx.putImageData(imageData, 0, 0);
    fullCtx.drawImage(temp, patch.dims.left, patch.dims.top);
    rawFrames.push({
      imageData: drawScaledFrame(ctx, full, outW, outH),
      delayMs: Math.max(10, (patch.delay || 10) * 10),
    });
    onProgress?.(0.1 + (0.5 * (i + 1)) / patches.length);
  }

  return { frames: rawFrames, width: outW, height: outH };
}

export async function extractFramesFromGif(file, targetWidth, targetFps, onProgress) {
  const buffer = await file.arrayBuffer();
  onProgress?.(0.05, "正在解码 GIF（FFmpeg 等效）…");
  const { frames: rawFrames, width, height } = await decodeGifWithImageDecoder(
    buffer,
    targetWidth,
    onProgress
  );
  onProgress?.(0.55, "正在按目标帧率重采样…");
  const frames = resampleByFps(rawFrames, targetFps);
  if (!frames.length) throw new Error("未能从 GIF 中提取帧");
  return { frames, width, height };
}

export async function extractFramesFromVideo(file, targetWidth, targetFps, onProgress) {
  const url = URL.createObjectURL(file);
  let captureHost = null;
  let video = null;

  try {
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.playsinline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "auto";
    video.src = url;

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("无法加载视频文件"));
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) throw new Error("无法读取视频尺寸");

    const { width: outW, height: outH } = computeOutputSize(srcW, srcH, targetWidth);
    if (outW * outH > MAX_PIXELS) {
      throw new Error(`输出分辨率过大（${outW}×${outH}），请降低图像尺寸`);
    }

    captureHost = mountVideoForCapture(video, srcW, srcH);
    await video.play().catch(() => {});
    await waitForVideoFrameReady();

    onProgress?.(0.05, `正在从 MP4 抽帧（${outW}×${outH}）…`);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("无法读取视频时长");
    }

    const interval = 1 / targetFps;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const rawFrames = [];
    for (let t = 0; t < duration && rawFrames.length < MAX_FRAMES; t += interval) {
      video.currentTime = Math.min(t, duration - 0.001);
      await new Promise((resolve, reject) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", () => reject(new Error("视频抽帧失败")), {
          once: true,
        });
      });
      await waitForVideoFrameReady();

      const imageData = await captureFrameFromVideo(ctx, video, outW, outH, srcW);
      if (rawFrames.length === 0) {
        assertFrameDimensions(imageData, outW, outH, srcW, srcH);
      }

      rawFrames.push({
        imageData,
        delayMs: interval * 1000,
      });
      onProgress?.(0.1 + (0.45 * (t + interval)) / duration);
    }

    onProgress?.(0.55, "抽帧完成");
    const frames = rawFrames.map((f) => f.imageData);
    if (!frames.length) throw new Error("未能从视频中提取帧");
    return { frames, width: outW, height: outH };
  } finally {
    video?.pause?.();
    unmountVideoCapture(captureHost);
    URL.revokeObjectURL(url);
  }
}

export async function extractFrames(file, targetWidth, targetFps, onProgress) {
  if (isGifFile(file)) {
    return extractFramesFromGif(file, targetWidth, targetFps, onProgress);
  }
  if (isVideoFile(file)) {
    return extractFramesFromVideo(file, targetWidth, targetFps, onProgress);
  }
  throw new Error("不支持的文件格式，请上传 GIF 或 MP4/WebM 视频");
}
