const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");

const state = {
  feed: [],
  presence: {},
  queue: []
};
const normalizeQueue = (queue) => Array.from(new Set((queue || []).filter(Boolean)));
const cleanupState = () => {
  const active = new Set(Object.keys(state.presence));
  state.queue = normalizeQueue(state.queue).filter((name) => active.has(name));
  state.feed = Array.isArray(state.feed) ? state.feed.slice(0, 30) : [];
};

const sendJson = (res, code, body) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
};

const setCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/sync/state") {
    setCors(res);
    cleanupState();
    sendJson(res, 200, state);
    return;
  }

  if (req.method === "POST" && pathname === "/sync/patch") {
    setCors(res);
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(raw || "{}");
        if (Array.isArray(payload.feed)) {
          const mergedFeed = new Map();
          [...state.feed, ...payload.feed].forEach((post) => {
            if (!post || !post.id) return;
            const current = mergedFeed.get(post.id);
            if (!current || Number(post.likes || 0) >= Number(current.likes || 0)) {
              mergedFeed.set(post.id, post);
            }
          });
          state.feed = Array.from(mergedFeed.values()).slice(0, 30);
        }
        if (payload.presence && typeof payload.presence === "object") {
          Object.entries(payload.presence).forEach(([name, ts]) => {
            const current = Number(state.presence[name] || 0);
            const next = Number(ts || 0);
            if (next > current) state.presence[name] = next;
          });
        }
        if (Array.isArray(payload.queue)) {
          state.queue = normalizeQueue([...state.queue, ...payload.queue]);
        }
        cleanupState();
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { ok: false });
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(INDEX, (err, content) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Server error");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(content);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});
