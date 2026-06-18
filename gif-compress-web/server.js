const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = __dirname;
const port = Number(process.env.PORT) || 8888;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// Detect LAN IP
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}
const lanIP = getLanIP();

// SSE clients waiting for preview push
const sseClients = new Set();
let lastPreviewPayload = null; // cache latest payload for new subscribers

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);

    // --- GET /server-info: returns LAN IP and port ---
    if (urlPath === "/server-info") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ lanIP, port }));
      return;
    }

    // --- SSE: mobile preview subscribes here ---
    if (urlPath === "/preview-sse") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": connected\n\n");

      // Send cached payload immediately if available
      if (lastPreviewPayload) {
        res.write(`data: ${lastPreviewPayload}\n\n`);
      }

      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    // --- POST /preview-push: desktop pushes base64 data here ---
    if (urlPath === "/preview-push" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        lastPreviewPayload = body;
        for (const client of sseClients) {
          try { client.write(`data: ${body}\n\n`); } catch { sseClients.delete(client); }
        }
        res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
        res.end("ok");
      });
      return;
    }

    // --- OPTIONS preflight for /preview-push ---
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // --- Static file serving ---
    const filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    });
  })
  .listen(port, () => {
    console.log(`GIF 压缩网页: http://localhost:${port}`);
    console.log(`局域网访问: http://${lanIP}:${port}`);
  });
