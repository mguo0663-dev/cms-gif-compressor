/**
 * GIF 编码：优先 Gifski（与桌面版一致），若输出尺寸不符则自动改用 gifenc 保持原尺寸
 */
import encodeGifski from "https://esm.sh/gifski-wasm@2.2.0";
import { GIFEncoder, quantize, applyPalette } from "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm";

function readGifLogicalSize(bytes) {
  if (bytes.byteLength < 10) return null;
  return {
    width: bytes[6] | (bytes[7] << 8),
    height: bytes[8] | (bytes[9] << 8),
  };
}

function normalizeFrames(frames, w, h) {
  const perFrame = w * h * 4;
  return frames.map((frame, i) => {
    if (frame instanceof ImageData) {
      if (frame.width !== w || frame.height !== h) {
        throw new Error(
          `第 ${i + 1} 帧尺寸为 ${frame.width}×${frame.height}，需要 ${w}×${h}`
        );
      }
      if (frame.data.length !== perFrame) {
        const actualH = Math.round(frame.data.length / 4 / frame.width);
        throw new Error(
          `第 ${i + 1} 帧像素不足（实际约 ${frame.width}×${actualH}），需要 ${w}×${h}`
        );
      }
      return frame;
    }
    if (frame.length !== perFrame) {
      throw new Error(
        `第 ${i + 1} 帧像素字节数为 ${frame.length}，需要 ${perFrame}（${w}×${h}）`
      );
    }
    return frame;
  });
}

function encodeGifenc(frames, w, h, fps) {
  const enc = GIFEncoder();
  const delay = Math.max(20, Math.round(1000 / fps));
  for (const frame of frames) {
    const rgba = frame instanceof ImageData ? frame.data : frame;
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    enc.writeFrame(index, w, h, { palette, delay });
  }
  enc.finish();
  return new Uint8Array(enc.bytes());
}

async function tryGifski(frames, w, h, fps, quality) {
  const rgbaFrames = frames.map((frame) =>
    frame instanceof ImageData
      ? new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.length)
      : frame
  );
  return encodeGifski({
    frames: rgbaFrames,
    width: w,
    height: h,
    fps,
    quality,
    resizeWidth: w,
    resizeHeight: h,
  });
}

self.onmessage = async (event) => {
  const { frames, width, height, fps, quality } = event.data;
  try {
    const normalized = normalizeFrames(frames, width, height);
    let gif;
    let encoder = "gifski";

    try {
      gif = await tryGifski(normalized, width, height, fps, quality);
      const size = readGifLogicalSize(gif);
      if (size && (size.width !== width || size.height !== height)) {
        gif = encodeGifenc(normalized, width, height, fps);
        encoder = "gifenc";
      }
    } catch {
      gif = encodeGifenc(normalized, width, height, fps);
      encoder = "gifenc";
    }

    const outSize = readGifLogicalSize(gif);
    if (outSize && (outSize.width !== width || outSize.height !== height)) {
      throw new Error(
        `无法生成 ${width}×${height} 的 GIF（实际 ${outSize.width}×${outSize.height}），请降低分辨率后重试`
      );
    }

    self.postMessage({ ok: true, gif, encoder }, [gif.buffer]);
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err?.message || String(err),
    });
  }
};
