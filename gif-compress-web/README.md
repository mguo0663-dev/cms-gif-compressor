# GIF 压缩智慧版 · 网页

基于桌面版 `tools.zip` 中的 **FFmpeg + Gifski** 技术路线，在浏览器中实现同等流程：

| 桌面端 | 网页端 |
|--------|--------|
| `ffmpeg` 解码 / `fps` / `scale` | Canvas + `ImageDecoder` / 视频抽帧 |
| `gifski.exe` 高质量编码 | [gifski-wasm](https://github.com/jamsinclair/gifski-wasm) |

所有处理在本地完成，不上传文件。

## 使用

需通过本地 HTTP 服务打开（Worker 与 WASM 模块无法从 `file://` 正常加载）：

```bash
cd gif-compress-web
npx --yes serve -p 8080
```

浏览器访问：http://localhost:8080

## 功能模式

- **GIF 压缩**：上传已有 GIF，按参数重新编码压缩
- **MP4 转 GIF**：上传 MP4，先抽帧转 GIF，再经 Gifski 压缩；转换完成后可一键「发送到 GIF 压缩」继续优化

## 参数说明

- **画质**：对应 `gifski --quality`（默认 80）
- **帧率**：对应 `ffmpeg -vf fps=N`
- **图像尺寸**：相对原图宽度的百分比，**默认 100% 原尺寸**（高度按比例）

## 支持格式

- GIF 压缩模式：`.gif`
- MP4 转 GIF 模式：`.mp4`（及常见 MP4 容器）
