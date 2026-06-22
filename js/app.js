import {
  extractFrames,
  formatBytes,
  probeMediaSize,
  targetWidthFromPercent,
  isGifFile,
  isVideoFile,
} from "./decoder.js";

const $ = (id) => document.getElementById(id);

const dropZone = $("dropZone");
const fileInput = $("fileInput");
const uploadPrompt = $("uploadPrompt");
const uploadTitle = $("uploadTitle");
const uploadHint = $("uploadHint");
const previewArea = $("previewArea");
const previewOrigImg = $("previewOrigImg");
const previewOrigVideo = $("previewOrigVideo");
const fileMeta = $("fileMeta");
const originalCardHeader = $("originalCardHeader");
const fileSize = $("fileSize");
const fileDimensions = $("fileDimensions");
const fileBitrate = $("fileBitrate");
const bitrateItem = $("bitrateItem");
const paramsPanel = $("paramsPanel");
const loadingPanel = $("loadingPanel");
const loadingText = $("loadingText");
const resultPreview = $("resultPreview");
const resultPanel = $("resultPanel");
const compressBtn = $("compressBtn");
const btnLabel = $("btnLabel");
const errorMsg = $("errorMsg");
const quality = $("quality");
const fps = $("fps");
const imageSize = $("imageSize");
const qualityVal = $("qualityVal");
const fpsVal = $("fpsVal");
const sizeVal = $("sizeVal");
const sizeHint = $("sizeHint");
const modeGif = $("modeGif");
const modeMp4 = $("modeMp4");
const origSize = $("origSize");
const newSize = $("newSize");
const savedPct = $("savedPct");
const previewNew = $("previewNew");
const downloadBtn = $("downloadBtn");
const compressAgain = $("compressAgain");

// 简单GIF预览lightbox（压缩后卡片点击放大）
const gifLightbox = $("gifLightbox");
const gifLightboxBackdrop = $("gifLightboxBackdrop");
const gifLightboxImg = $("gifLightboxImg");
const gifLightboxVideo = $("gifLightboxVideo");

// Overlay预览lightbox（最右侧效果预览点击放大）
const lightbox = $("lightbox");
const lightboxBackdrop = $("lightboxBackdrop");
const lightboxStage = $("lightboxStage");
const lightboxBase = $("lightboxBase");
const lightboxGif = $("lightboxGif");
const lightboxOverlay = $("lightboxOverlay");
const lightboxInfo = $("lightboxInfo");
const posX = $("posX");
const posY = $("posY");
const scaleVal = $("scaleVal");

const overlayBase = $("overlayBase");
const overlayGif = $("overlayGif");
const overlayStage = $("overlayStage");
const bgImageInput = $("bgImageInput");
const bgUploadBtn = $("bgUploadBtn");

const uploadIconMp4 = $("uploadIconMp4");
const uploadIconGif = $("uploadIconGif");

const DEFAULT_BG = "assets/mockup-bg-new.png";

let currentFile = null;
let origObjectUrl = null;
let resultBlob = null;
let resultObjectUrl = null;
let currentMode = "mp4";
let lastEncodedSize = null;
let sourceSize = null;
let showResult = false;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let currentTranslateX = 0;
let currentTranslateY = 0;
let currentScale = 1;

const MODE_CONFIG = {
  gif: {
    accept: "image/gif",
    uploadTitle: '<span class="upload-click">点击</span>/拖拽文件到此处压缩',
    uploadHint: "支持GIF格式，文件不超过200MB",
    btnLabel: "开始压缩",
    progressEncode: (n) => `Gifski 压缩编码中（${n} 帧）…`,
  },
  mp4: {
    accept: "video/mp4,video/quicktime,.mp4,.m4v",
    uploadTitle: '<span class="upload-click">点击</span>/拖拽文件到此处压缩',
    uploadHint: "支持MP4格式，文件不超过200MB",
    btnLabel: "转换并压缩",
    progressEncode: (n) => `Gifski 转 GIF 并压缩（${n} 帧）…`,
  },
};

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
  errorMsg.style.animation = 'none';
  setTimeout(() => errorMsg.style.animation = 'shake 0.5s ease', 10);
}

function hideError() {
  errorMsg.classList.add("hidden");
}

function formatSizeLabel(percent) {
  if (!sourceSize) return `${percent}%`;
  const tw = targetWidthFromPercent(sourceSize.width, percent);
  const th = Math.max(1, Math.round((sourceSize.height * tw) / sourceSize.width));
  if (percent >= 100) {
    return `原尺寸 · ${sourceSize.width}×${sourceSize.height}`;
  }
  return `${percent}% · ${tw}×${th}`;
}

async function getGifMetadata(file) {
  const buffer = await file.arrayBuffer();
  const { parseGIF, decompressFrames } = await import(
    "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm"
  );
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);

  let totalDuration = 0;
  for (const frame of frames) {
    totalDuration += (frame.delay || 10) * 10;
  }

  const avgFps = frames.length > 0 && totalDuration > 0
    ? (frames.length * 1000) / totalDuration
    : 0;

  return {
    frames: frames.length,
    fps: Math.round(avgFps),
    duration: totalDuration,
    width: gif.lsd.width,
    height: gif.lsd.height
  };
}

async function getVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.style.display = "none";
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "-9999px";
    video.src = url;

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("无法读取视频元数据"));
    };

    video.onloadedmetadata = () => {
      const videoDuration = video.duration || 0;
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      const duration = videoDuration * 1000;
      const bitrate = duration > 0
        ? Math.round((file.size * 8) / (duration / 1000))
        : 0;

      resolve({
        frames: Math.round(videoDuration * 25),
        fps: 25,
        duration: duration,
        width: videoWidth,
        height: videoHeight,
        bitrate: bitrate
      });

      cleanup();
    };
  });
}

async function showFileInfo(file, size) {
  fileSize.textContent = formatBytes(file.size);
  fileDimensions.textContent = `${size.width} × ${size.height}`;

  uploadPrompt.classList.add("hidden");
  previewArea.classList.remove("hidden");
  fileMeta.classList.remove("hidden");
  originalCardHeader.classList.remove("hidden");

  if (isGifFile(file)) {
    previewOrigImg.src = origObjectUrl;
    previewOrigImg.classList.remove("hidden");
    previewOrigVideo.classList.add("hidden");
    bitrateItem.classList.add("hidden");

    try {
      const meta = await getGifMetadata(file);
      console.log("GIF metadata:", meta);
    } catch (e) {
      console.error("获取GIF元数据失败:", e);
    }
  } else if (isVideoFile(file)) {
    previewOrigImg.classList.add("hidden");
    bitrateItem.classList.remove("hidden");
    fileBitrate.textContent = "检测中...";

    previewOrigVideo.src = origObjectUrl;
    
    await new Promise((resolve) => {
      const onLoaded = () => {
        previewOrigVideo.removeEventListener("loadeddata", onLoaded);
        previewOrigVideo.removeEventListener("loadedmetadata", onLoaded);
        resolve();
      };
      if (previewOrigVideo.readyState >= 2) {
        resolve();
      } else {
        previewOrigVideo.addEventListener("loadeddata", onLoaded);
        previewOrigVideo.addEventListener("loadedmetadata", onLoaded);
      }
    });

    previewOrigVideo.classList.remove("hidden");

    try {
      const meta = await getVideoMetadata(file);
      fileBitrate.textContent = meta.bitrate > 0
        ? `${(meta.bitrate / 1000000).toFixed(2)} Mbps`
        : "—";
    } catch (e) {
      console.error("获取视频元数据失败:", e);
      fileBitrate.textContent = "—";
    }
  }
}

function updateSizeDisplay() {
  const pct = Number(imageSize.value);
  sizeVal.textContent = formatSizeLabel(pct);
}

async function applySourceSize(file, knownSize = null) {
  sourceSize = null;
  imageSize.disabled = true;
  sizeVal.textContent = "读取中…";
  sizeHint.textContent = "正在读取原图分辨率…";

  try {
    sourceSize = knownSize ?? (await probeMediaSize(file));
    imageSize.value = "100";
    imageSize.disabled = false;
    sizeHint.textContent = `原图 ${sourceSize.width}×${sourceSize.height}，默认 100% 原尺寸`;
    updateSizeDisplay();
  } catch {
    imageSize.disabled = false;
    imageSize.value = "100";
    sizeVal.textContent = "原尺寸";
    sizeHint.textContent = "无法读取尺寸，将按原图处理";
  }
}

function applyModeChrome(mode) {
  const cfg = MODE_CONFIG[mode];
  modeGif.classList.toggle("active", mode === "gif");
  modeMp4.classList.toggle("active", mode === "mp4");
  fileInput.accept = cfg.accept;
  uploadTitle.innerHTML = cfg.uploadTitle;
  uploadHint.textContent = cfg.uploadHint;
  btnLabel.textContent = cfg.btnLabel;
  
  if (uploadIconMp4 && uploadIconGif) {
    uploadIconMp4.classList.toggle("hidden", mode === "gif");
    uploadIconGif.classList.toggle("hidden", mode === "mp4");
  }
}

function refreshModeUI() {
  hideError();
  compressBtn.disabled = false;
  btnLabel.textContent = MODE_CONFIG[currentMode].btnLabel;

  if (currentFile) {
    if (origObjectUrl) {
      if (isGifFile(currentFile)) {
        previewOrigImg.src = origObjectUrl;
        previewOrigImg.classList.remove("hidden");
        previewOrigVideo.classList.add("hidden");
      } else {
        previewOrigVideo.src = origObjectUrl;
        previewOrigVideo.classList.remove("hidden");
        previewOrigImg.classList.add("hidden");
      }
    }
    if (sourceSize) {
      imageSize.disabled = false;
      sizeHint.textContent = `原图 ${sourceSize.width}×${sourceSize.height}，默认 100% 原尺寸`;
      updateSizeDisplay();
    } else {
      imageSize.disabled = true;
      sizeVal.textContent = "原尺寸";
      sizeHint.textContent = "加载文件后显示原图分辨率，默认 100% 原尺寸";
    }
  } else {
    uploadPrompt.classList.remove("hidden");
    previewArea.classList.add("hidden");
    fileMeta.classList.add("hidden");
    originalCardHeader.classList.add("hidden");
    previewOrigImg.removeAttribute("src");
    previewOrigVideo.removeAttribute("src");
    imageSize.value = "100";
    imageSize.disabled = true;
    sizeVal.textContent = "原尺寸";
    sizeHint.textContent = "加载文件后显示原图分辨率，默认 100% 原尺寸";
  }

  if (showResult && resultBlob && resultObjectUrl && currentFile) {
    paramsPanel.classList.add("hidden");
    loadingPanel.classList.add("hidden");
    resultPreview.classList.remove("hidden");
    resultPanel.classList.remove("hidden");
    
    previewNew.src = resultObjectUrl;
    downloadBtn.href = resultObjectUrl;
    const base = currentFile.name.replace(/\.[^.]+$/, "");
    downloadBtn.download =
      currentMode === "mp4" ? `${base}.gif` : `${base}_compressed.gif`;
    animateBytes(origSize, currentFile.size);
    animateBytes(newSize, resultBlob.size);
    const saved =
      currentFile.size > 0
        ? ((1 - resultBlob.size / currentFile.size) * 100).toFixed(1)
        : "0";
    const savedText =
      resultBlob.size < currentFile.size ? `${saved}%` : `${Math.abs(saved)}%`;
    animateNumber(savedPct, savedText);

    const leftPreviewArea = document.getElementById("previewArea");
    const rightResultArea = resultPreview.querySelector(".preview-area");
    if (leftPreviewArea && rightResultArea) {
      const rect = leftPreviewArea.getBoundingClientRect();
      rightResultArea.style.width = rect.width + "px";
      rightResultArea.style.height = rect.height + "px";
    }
  } else {
    resultPanel.classList.add("hidden");
    resultPreview.classList.add("hidden");
    loadingPanel.classList.add("hidden");
    paramsPanel.classList.toggle("hidden", !currentFile);
  }

  if (resultObjectUrl) {
    overlayGif.src = resultObjectUrl;
    overlayGif.classList.remove("hidden");
  } else {
    overlayGif.classList.add("hidden");
    overlayGif.removeAttribute("src");
  }
}

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;
  applyModeChrome(mode);
  refreshModeUI();

  const activeTab = mode === "gif" ? modeGif : modeMp4;
  activeTab.classList.add("tab-flash");
  setTimeout(() => activeTab.classList.remove("tab-flash"), 1000);
}

function validateFileForMode(file) {
  if (currentMode === "gif" && !isGifFile(file)) {
    throw new Error("当前为「GIF 压缩」模式，请上传 GIF 文件");
  }
  if (currentMode === "mp4" && !isVideoFile(file)) {
    throw new Error("当前为「MP4 转 GIF」模式，请上传 MP4 视频");
  }
}

async function selectFile(file) {
  if (!file) return;
  hideError();
  try {
    validateFileForMode(file);
  } catch (err) {
    showError(err.message);
    return;
  }

  currentFile = file;
  showResult = false;
  paramsPanel.classList.remove("hidden");
  resultPanel.classList.add("hidden");
  resultPreview.classList.add("hidden");
  loadingPanel.classList.add("hidden");
  
  document.querySelector(".cards-container").classList.add("has-file");

  if (origObjectUrl) URL.revokeObjectURL(origObjectUrl);
  origObjectUrl = URL.createObjectURL(file);

  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = null;
  }
  resultBlob = null;
  lastEncodedSize = null;

  quality.value = "40";
  qualityVal.textContent = "40";
  fps.value = "12";
  fpsVal.textContent = "12";
  imageSize.value = "100";

  await applySourceSize(file);
  
  if (sourceSize) {
    await showFileInfo(file, sourceSize);
  }
}

function resetFile() {
  if (origObjectUrl) {
    URL.revokeObjectURL(origObjectUrl);
    origObjectUrl = null;
  }
  if (resultObjectUrl) {
    URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = null;
  }
  currentFile = null;
  sourceSize = null;
  resultBlob = null;
  lastEncodedSize = null;
  showResult = false;
  fileInput.value = "";

  overlayGif.classList.add("hidden");
  overlayGif.removeAttribute("src");
  
  uploadPrompt.classList.remove("hidden");
  previewArea.classList.add("hidden");
  fileMeta.classList.add("hidden");
  originalCardHeader.classList.add("hidden");
  paramsPanel.classList.add("hidden");
  resultPanel.classList.add("hidden");
  resultPreview.classList.add("hidden");
  loadingPanel.classList.add("hidden");
  
  document.querySelector(".cards-container").classList.remove("has-file");
  
  imageSize.value = "100";
  imageSize.disabled = true;
  sizeVal.textContent = "原尺寸";
  sizeHint.textContent = "加载文件后显示原图分辨率，默认 100% 原尺寸";
}

function encodeWithGifski(frames, width, height, fpsVal, qualityVal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("./js/encoder-worker.js", { type: "module" });

    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data.ok) resolve({ gif: e.data.gif, encoder: e.data.encoder || "gifski" });
      else reject(new Error(e.data.error || "Gifski 编码失败"));
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "Worker 加载失败，请通过本地服务器打开页面"));
    };

    worker.postMessage({
      frames,
      width,
      height,
      fps: fpsVal,
      quality: qualityVal,
    });
  });
}

async function runCompress() {
  if (!currentFile) return;

  hideError();
  const cfg = MODE_CONFIG[currentMode];
  compressBtn.disabled = true;
  btnLabel.innerHTML = '<span class="btn-spinner"></span> ' + (currentMode === "mp4" ? "转换中…" : "压缩中…");
  
  previewOrigVideo.pause();
  
  const leftPreviewArea = document.getElementById("previewArea");
  const rightLoadingArea = loadingPanel.querySelector(".preview-area");
  
  paramsPanel.classList.add("hidden");
  loadingPanel.classList.remove("hidden");
  resultPreview.classList.add("hidden");
  resultPanel.classList.add("hidden");
  loadingText.textContent = "准备中…";

  const syncLoadingSize = () => {
    if (!leftPreviewArea || !rightLoadingArea) return;
    const leftRect = leftPreviewArea.getBoundingClientRect();
    rightLoadingArea.style.width = leftRect.width + "px";
    rightLoadingArea.style.height = leftRect.height + "px";
  };
  
  syncLoadingSize();
  window.addEventListener("resize", syncLoadingSize);

  const q = Number(quality.value);
  const f = Number(fps.value);
  const sizePercent = Number(imageSize.value);
  const targetWidth = sourceSize
    ? targetWidthFromPercent(sourceSize.width, sizePercent)
    : null;

  try {
    if (currentFile.size > 80 * 1024 * 1024) {
      throw new Error("文件超过 80MB，请先裁剪或缩短后再处理");
    }

    loadingText.textContent = "提取帧中…";
    const { frames, width: fw, height: fh } = await extractFrames(
      currentFile,
      targetWidth,
      f,
      (p) => {
        loadingText.textContent = `提取帧中… ${Math.round(p * 100)}%`;
      }
    );

    const frameW = frames[0]?.width ?? fw;
    const frameH = frames[0]?.height ?? fh;
    if (frameW !== fw || frameH !== fh) {
      throw new Error(
        `帧尺寸 ${frameW}×${frameH} 与目标 ${fw}×${fh} 不一致，已中止以免输出缩小版 GIF`
      );
    }

    loadingText.textContent = cfg.progressEncode(frames.length);
    const { gif: gifBytes } = await encodeWithGifski(
      frames,
      frameW,
      frameH,
      f,
      q
    );

    loadingText.textContent = "完成";
    resultBlob = new Blob([gifBytes], { type: "image/gif" });
    lastEncodedSize = await probeMediaSize(
      new File([resultBlob], "out.gif", { type: "image/gif" })
    );
    if (lastEncodedSize.width !== frameW || lastEncodedSize.height !== frameH) {
      throw new Error(
        `GIF 实际输出为 ${lastEncodedSize.width}×${lastEncodedSize.height}，未达到 ${frameW}×${frameH}`
      );
    }
    if (resultObjectUrl) URL.revokeObjectURL(resultObjectUrl);
    resultObjectUrl = URL.createObjectURL(resultBlob);
    showResult = true;

    animateBytes(origSize, currentFile.size);
    animateBytes(newSize, resultBlob.size);
    const saved =
      currentFile.size > 0
        ? ((1 - resultBlob.size / currentFile.size) * 100).toFixed(1)
        : "0";
    const savedText =
      resultBlob.size < currentFile.size ? `${saved}%` : `${Math.abs(saved)}%`;
    animateNumber(savedPct, savedText);

    previewNew.src = resultObjectUrl;
    downloadBtn.href = resultObjectUrl;
    const base = currentFile.name.replace(/\.[^.]+$/, "");
    downloadBtn.download =
      currentMode === "mp4" ? `${base}.gif` : `${base}_compressed.gif`;

    overlayGif.src = resultObjectUrl;
    overlayGif.classList.remove("hidden");

    loadingPanel.classList.add("hidden");
    window.removeEventListener("resize", syncLoadingSize);
    
    resultPreview.classList.remove("hidden");
    resultPanel.classList.remove("hidden");
    
    const rightResultArea = resultPreview.querySelector(".preview-area");
    if (rightResultArea) {
      const syncResultSize = () => {
        if (!leftPreviewArea) return;
        const leftRect = leftPreviewArea.getBoundingClientRect();
        rightResultArea.style.width = leftRect.width + "px";
        rightResultArea.style.height = leftRect.height + "px";
      };
      syncResultSize();
      window.addEventListener("resize", syncResultSize);
    }
    
    resultPanel.classList.add("success-pulse");
    setTimeout(() => resultPanel.classList.remove("success-pulse"), 600);
    
    if (currentFile && !isGifFile(currentFile) && !previewOrigVideo.paused) {
      previewOrigVideo.play().catch(() => {});
    }
  } catch (err) {
    console.error(err);
    showError(err.message || "处理失败");
    loadingPanel.classList.add("hidden");
    window.removeEventListener("resize", syncLoadingSize);
    paramsPanel.classList.remove("hidden");
  } finally {
    compressBtn.disabled = false;
    btnLabel.textContent = cfg.btnLabel;
    if (currentFile && !isGifFile(currentFile) && previewOrigVideo.src) {
      previewOrigVideo.play().catch(() => {});
    }
  }
}

function bindSliders() {
  quality.addEventListener("input", () => {
    qualityVal.textContent = quality.value;
    updateSliderGradient(quality);
  });
  fps.addEventListener("input", () => {
    fpsVal.textContent = fps.value;
    updateSliderGradient(fps);
  });
  imageSize.addEventListener("input", () => {
    updateSizeDisplay();
    updateSliderGradient(imageSize);
  });
  
  updateSliderGradient(quality);
  updateSliderGradient(fps);
  updateSliderGradient(imageSize);
}

function animateNumber(element, targetValue, duration = 800) {
  const startValue = parseFloat(element.textContent.replace(/[^0-9.-]/g, "")) || 0;
  const targetNum = parseFloat(targetValue.replace(/[^0-9.-]/g, ""));
  const suffix = targetValue.replace(/[0-9.-]/g, "");
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (targetNum - startValue) * eased;
    
    element.textContent = suffix.includes("%") 
      ? `${currentValue.toFixed(1)}${suffix}` 
      : `${currentValue.toFixed(1)} ${suffix}`;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function animateBytes(element, bytes) {
  const formatted = formatBytes(bytes);
  const numPart = parseFloat(formatted.replace(/[^0-9.]/g, ""));
  const unitPart = formatted.replace(/[0-9.]/g, "").trim();
  const startValue = parseFloat(element.textContent.replace(/[^0-9.]/g, "")) || 0;
  const duration = 800;
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (numPart - startValue) * eased;
    
    element.textContent = `${currentValue.toFixed(1)} ${unitPart}`;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

function updateSliderGradient(slider) {
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const value = parseInt(slider.value);
  const percent = ((value - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #1370FF 0%, #1370FF ${percent}%, #e5e7eb ${percent}%, #e5e7eb 100%)`;
}

modeGif.addEventListener("click", () => setMode("gif"));
modeMp4.addEventListener("click", () => setMode("mp4"));

dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) selectFile(fileInput.files[0]);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) selectFile(file);
});

compressBtn.addEventListener("click", runCompress);
compressAgain.addEventListener("click", () => {
  showResult = false;
  resultPanel.classList.add("hidden");
  resultPreview.classList.add("hidden");
  paramsPanel.classList.remove("hidden");
});

bgUploadBtn.addEventListener("click", () => bgImageInput.click());
bgImageInput.addEventListener("change", () => {
  const bgFile = bgImageInput.files[0];
  if (bgFile) {
    if (bgImageObjectUrl) URL.revokeObjectURL(bgImageObjectUrl);
    bgImageObjectUrl = URL.createObjectURL(bgFile);
    overlayBase.src = bgImageObjectUrl;
  }
});

let bgImageObjectUrl = null;

// 简单GIF预览lightbox函数
function openGifLightbox(isOriginal = false) {
  gifLightbox.classList.remove("hidden");
  gifLightboxImg.classList.add("hidden");
  gifLightboxVideo.classList.add("hidden");
  gifLightboxVideo.pause();
  gifLightboxVideo.src = "";
  
  const url = isOriginal ? origObjectUrl : resultObjectUrl;
  const isVideo = isOriginal && currentFile && currentFile.type.startsWith("video/");
  
  if (isVideo) {
    gifLightboxVideo.src = url;
    gifLightboxVideo.classList.remove("hidden");
    gifLightboxVideo.play().catch(() => {});
  } else {
    gifLightboxImg.src = url;
    gifLightboxImg.classList.remove("hidden");
  }
  
  document.body.style.overflow = "hidden";
}

function closeGifLightbox() {
  gifLightbox.classList.add("hidden");
  gifLightboxVideo.pause();
  gifLightboxVideo.src = "";
  document.body.style.overflow = "";
}

// Overlay预览lightbox函数
function openLightbox(isOriginal = false) {
  lightbox.classList.remove("hidden");
  lightboxBase.classList.add("hidden");
  lightboxGif.classList.add("hidden");
  lightboxOverlay.classList.add("hidden");
  
  const url = isOriginal ? origObjectUrl : resultObjectUrl;
  let targetImg;
  
  if (isOriginal && currentFile.type.startsWith("video/")) {
    lightboxBase.src = url;
    lightboxBase.classList.remove("hidden");
    targetImg = lightboxBase;
  } else {
    lightboxGif.src = url;
    lightboxGif.classList.remove("hidden");
    targetImg = lightboxGif;
  }
  
  function setupContentSize() {
    const stage = document.getElementById("lightboxStage");
    const card = document.getElementById("lightboxCard");
    const content = document.getElementById("lightboxContent");
    
    const maxHeight = window.innerHeight * 0.95;
    const maxWidth = window.innerWidth * 0.95;
    const cardRatio = 16 / 9;
    let stageWidth, stageHeight;
    if (maxWidth / maxHeight > cardRatio) {
      stageHeight = maxHeight;
      stageWidth = maxHeight * cardRatio;
    } else {
      stageWidth = maxWidth;
      stageHeight = maxWidth / cardRatio;
    }
    stage.style.width = stageWidth + "px";
    stage.style.height = stageHeight + "px";
    card.style.width = stageWidth + "px";
    card.style.height = stageHeight + "px";
    
    content.style.width = "1920px";
    content.style.height = "1080px";
    
    resetTransform(stageWidth, stageHeight);
  }
  
  if (targetImg.complete && targetImg.naturalWidth > 0) {
    setupContentSize();
  } else {
    targetImg.onload = setupContentSize;
  }
  
  document.body.style.overflow = "hidden";
}

function openOverlayLightbox() {
  lightbox.classList.remove("hidden");
  lightboxBase.classList.add("hidden");
  lightboxGif.classList.add("hidden");
  lightboxOverlay.classList.add("hidden");
  
  lightboxBase.src = overlayBase.src;
  lightboxBase.classList.remove("hidden");
  
  if (!overlayGif.classList.contains("hidden") && overlayGif.src) {
    lightboxGif.src = overlayGif.src;
    lightboxGif.classList.remove("hidden");
  }
  
  lightboxOverlay.classList.remove("hidden");
  
  function setupContentSize() {
    const stage = document.getElementById("lightboxStage");
    const card = document.getElementById("lightboxCard");
    const content = document.getElementById("lightboxContent");
    
    const maxHeight = window.innerHeight * 0.95;
    const maxWidth = window.innerWidth * 0.95;
    const cardRatio = 16 / 9;
    let stageWidth, stageHeight;
    if (maxWidth / maxHeight > cardRatio) {
      stageHeight = maxHeight;
      stageWidth = maxHeight * cardRatio;
    } else {
      stageWidth = maxWidth;
      stageHeight = maxWidth / cardRatio;
    }
    stage.style.width = stageWidth + "px";
    stage.style.height = stageHeight + "px";
    card.style.width = stageWidth + "px";
    card.style.height = stageHeight + "px";
    
    content.style.width = "1920px";
    content.style.height = "1080px";
    
    resetTransform(stageWidth, stageHeight);
  }
  
  const baseImg = document.getElementById("lightboxBase");
  if (baseImg.complete && baseImg.naturalWidth > 0) {
    setupContentSize();
  } else {
    baseImg.onload = setupContentSize;
  }
  
  document.body.style.overflow = "hidden";
}

function getCardRect() {
  const card = document.getElementById("lightboxCard");
  return card ? card.getBoundingClientRect() : null;
}

function resizeStageByOverlay(img) {
  const maxHeight = window.innerHeight * 0.9;
  const maxWidth = window.innerWidth * 0.9;
  
  const cardRatio = 16 / 9;
  let targetWidth, targetHeight;
  if (maxWidth / maxHeight > cardRatio) {
    targetHeight = maxHeight;
    targetWidth = maxHeight * cardRatio;
  } else {
    targetWidth = maxWidth;
    targetHeight = maxWidth / cardRatio;
  }
  
  const stage = document.getElementById("lightboxStage");
  stage.style.width = targetWidth + "px";
  stage.style.height = targetHeight + "px";
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  document.body.style.overflow = "";
  isDragging = false;
  const content = document.getElementById("lightboxContent");
  if (content) content.style.transform = "";
}

function updateTransform() {
  const contentElement = document.getElementById("lightboxContent");
  if (contentElement) {
    const actualX = gifCurrentX * stageScale * gifCurrentScale;
    const actualY = gifCurrentY * stageScale * gifCurrentScale;
    contentElement.style.transform = `translate(${actualX}px, ${actualY}px) scale(${stageScale * gifCurrentScale})`;
  }
  updateInfo();
}

function updateInfo() {
  if (posX) posX.textContent = Math.round(gifCurrentX);
  if (posY) posY.textContent = Math.round(gifCurrentY);
  if (scaleVal) scaleVal.textContent = (gifCurrentScale * 100).toFixed(1) + "%";
}

function resetTransform(stageWidth, stageHeight) {
  gifCurrentX = 4529;
  gifCurrentY = 842;
  gifCurrentScale = 0.167;
  stageScale = stageHeight / DESIGN_HEIGHT;
  updateTransform();
}

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

let gifCurrentX = 0;
let gifCurrentY = 0;
let gifCurrentScale = 1;
let stageScale = 1;

const lightboxCard = document.getElementById("lightboxCard");

lightboxCard.addEventListener("mousedown", (e) => {
  isDragging = true;
  dragStartX = e.clientX - gifCurrentX * stageScale * gifCurrentScale;
  dragStartY = e.clientY - gifCurrentY * stageScale * gifCurrentScale;
  e.stopPropagation();
});

document.addEventListener("mousemove", (e) => {
  if (isDragging) {
    e.preventDefault();
    gifCurrentX = (e.clientX - dragStartX) / (stageScale * gifCurrentScale);
    gifCurrentY = (e.clientY - dragStartY) / (stageScale * gifCurrentScale);
    updateTransform();
  }
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

lightboxCard.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = -Math.sign(e.deltaY) * 0.001;
  let newScale = gifCurrentScale + delta;
  newScale = Math.max(0.01, Math.min(2, Math.round(newScale * 1000) / 1000));
  
  if (newScale !== gifCurrentScale) {
    const scaleRatio = newScale / gifCurrentScale;
    const rect = lightboxCard.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const designMouseX = mouseX / (stageScale * gifCurrentScale);
    const designMouseY = mouseY / (stageScale * gifCurrentScale);
    
    gifCurrentX = designMouseX - (designMouseX - gifCurrentX) * scaleRatio;
    gifCurrentY = designMouseY - (designMouseY - gifCurrentY) * scaleRatio;
    gifCurrentScale = newScale;
    
    updateTransform();
  }
}, { passive: false });

let lightboxShowingOriginal = false;

previewNew.addEventListener("click", (e) => {
  e.stopPropagation();
  if (resultObjectUrl) {
    lightboxShowingOriginal = false;
    openGifLightbox(false);
  }
});

resultPreview.addEventListener("click", () => {
  if (resultObjectUrl) {
    lightboxShowingOriginal = false;
    openGifLightbox(false);
  }
});

overlayStage.addEventListener("click", () => {
  openOverlayLightbox();
});

// 简单GIF lightbox事件
gifLightboxBackdrop.addEventListener("click", closeGifLightbox);

// Overlay lightbox事件
lightboxBackdrop.addEventListener("click", closeLightbox);

document.addEventListener("keydown", (e) => {
  // 简单GIF lightbox键盘事件
  if (e.key === "Escape" && !gifLightbox.classList.contains("hidden")) {
    closeGifLightbox();
  }
  
  if (e.key === " " && !gifLightbox.classList.contains("hidden")) {
    e.preventDefault();
    lightboxShowingOriginal = !lightboxShowingOriginal;
    openGifLightbox(lightboxShowingOriginal);
  }
  
  // Overlay lightbox键盘事件
  if (e.key === "Escape" && !lightbox.classList.contains("hidden")) {
    closeLightbox();
  }
});

bindSliders();
applyModeChrome("mp4");
refreshModeUI();