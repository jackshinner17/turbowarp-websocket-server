// TurboWarp WebSocket Relay Server — Cloudflare Worker + Durable Object
// Converted from the original Python asyncio + websockets server.

// ─── Durable Object ────────────────────────────────────────────────
class TurboWarpServer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();   // ws -> username (string | null)
    this.pairs = new Map();      // ws -> ws  (bidirectional)
    this.observers = new Set();  // log-viewer websockets
  }

  async fetch(request) {
    const url = new URL(request.url);
    const isWs = request.headers.get("Upgrade") === "websocket";

    // ── Non-WebSocket: serve the log viewer page ──
    if (!isWs) {
      if (url.pathname === "/" || url.pathname === "/logs") {
        return new Response(LOG_VIEWER_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Not found", { status: 404 });
    }

    // ── WebSocket upgrade ──
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (url.pathname === "/logs") {
      // Log viewer connection
      this.observers.add(server);
      server.addEventListener("close", () => {
        this.observers.delete(server);
        this.log("Log viewer disconnected");
      });
      server.addEventListener("error", () => {
        this.observers.delete(server);
      });
      this.log("Log viewer connected");
      server.send("Server: Log viewer connected");
    } else {
      // TurboWarp client connection
      this.sessions.set(server, null);
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      this.log("New connection from " + ip);

      server.addEventListener("message", (event) => {
        this.handleMessage(server, event.data).catch((err) =>
          console.error("Error handling message:", err)
        );
      });
      server.addEventListener("close", () => this.cleanup(server));
      server.addEventListener("error", () => this.cleanup(server));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(ws, raw) {
    if (typeof raw !== "string") {
      raw = new TextDecoder().decode(raw);
    }

    // 1. Set Username
    if (raw.startsWith("username:")) {
      const newName = raw.slice(9).trim();
      if (newName) {
        const oldName = this.sessions.get(ws);
        this.sessions.set(ws, newName);
        if (oldName) {
          ws.send("Server: Username changed from '" + oldName + "' to '" + newName + "'");
        } else {
          ws.send("Server: Username set to '" + newName + "'");
        }
        this.log("Connected: " + newName);
      } else {
        ws.send("Server: Username cannot be empty");
      }
      return;
    }

    // 2. Connect two clients by target username
    if (raw.startsWith("connect:")) {
      const senderName = this.sessions.get(ws);
      if (!senderName) {
        ws.send("Server: Error - Set a username first (use 'username:NAME')");
        return;
      }
      const targetName = raw.slice(8).trim();
      let targetWs = null;
      for (const [sock, name] of this.sessions) {
        if (name === targetName) {
          targetWs = sock;
          break;
        }
      }
      if (!targetWs) {
        ws.send("Server: Error - User '" + targetName + "' not found");
      } else if (targetWs === ws) {
        ws.send("Server: Error - Cannot connect to yourself");
      } else {
        this.pairs.set(ws, targetWs);
        this.pairs.set(targetWs, ws);
        this.log(targetName + " connected with " + senderName);
        ws.send("player1:" + targetName);
        targetWs.send("player2:" + senderName);
      }
      return;
    }

    // 3. active: command (sent to both connected clients)
    if (raw.startsWith("active:")) {
      const partnerWs = this.pairs.get(ws);
      if (!partnerWs) {
        ws.send("Server: Error - You are not connected to another client. Use 'connect:USERNAME'");
      } else {
        ws.send(raw);
        partnerWs.send(raw);
        this.log(raw);
      }
      return;
    }

    // 4. smack: command (sent to both connected clients)
    if (raw.startsWith("smack:")) {
      const partnerWs = this.pairs.get(ws);
      if (!partnerWs) {
        ws.send("Server: Error - You are not connected to another client. Use 'connect:USERNAME'");
      } else {
        ws.send(raw);
        partnerWs.send(raw);
        this.log(raw);
      }
      return;
    }

    // Echo fallback
    ws.send("Echo: " + raw);
  }

  cleanup(ws) {
    if (this.observers.has(ws)) {
      this.observers.delete(ws);
      return;
    }
    const partnerWs = this.pairs.get(ws);
    if (partnerWs) {
      this.pairs.delete(ws);
      this.pairs.delete(partnerWs);
      try {
        partnerWs.send("Server: Your connected partner disconnected.");
      } catch (e) {}
    }
    const username = this.sessions.get(ws) || "Unregistered user";
    this.sessions.delete(ws);
    this.log("Client disconnected: " + username);
  }

  log(message) {
    const ts = new Date().toISOString();
    const line = "[" + ts + "] " + message;
    console.log(line);
    for (const observer of this.observers) {
      try {
        observer.send(line);
      } catch (e) {}
    }
  }
}

// ─── Worker entry point ────────────────────────────────────────────
export { TurboWarpServer };

export default {
  async fetch(request, env) {
    const id = env.TURBOWARP_SERVER.idFromName("global");
    const stub = env.TURBOWARP_SERVER.get(id);
    return stub.fetch(request);
  },
};

// ─── Log Viewer HTML (served at /) ──────────────────────────────────
const LOG_VIEWER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TurboWarp Server — Live Logs</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; color: #e0e0e0; font-family: 'Courier New', monospace; height: 100vh; display: flex; flex-direction: column; }
header { background: #16213e; padding: 16px 24px; border-bottom: 1px solid #0f3460; display: flex; align-items: center; justify-content: space-between; }
h1 { font-size: 18px; color: #e94560; }
.status { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; background: #555; }
.status-dot.connected { background: #4ade80; }
.status-dot.disconnected { background: #ef4444; }
#log-container { flex: 1; overflow-y: auto; padding: 16px 24px; font-size: 14px; line-height: 1.6; }
.log-line { padding: 2px 0; word-break: break-all; }
.log-line .timestamp { color: #666; }
.log-line .msg { color: #e0e0e0; }
.log-line.error .msg { color: #ef4444; }
.log-line.info .msg { color: #4ade80; }
.log-line.event .msg { color: #60a5fa; }
.controls { padding: 12px 24px; background: #16213e; border-top: 1px solid #0f3460; display: flex; gap: 12px; align-items: center; }
button { background: #0f3460; color: #e0e0e0; border: 1px solid #1a1a4e; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 13px; }
button:hover { background: #1a4a80; }
.auto-scroll { display: flex; align-items: center; gap: 6px; font-size: 13px; }
</style>
</head>
<body>
<header>
<h1>TurboWarp Server — Live Logs</h1>
<div class="status"><span class="status-dot" id="status-dot"></span><span id="status-text">Connecting...</span></div>
</header>
<div id="log-container"></div>
<div class="controls">
<button onclick="clearLogs()">Clear</button>
<label class="auto-scroll"><input type="checkbox" id="auto-scroll" checked> Auto-scroll</label>
</div>
<script>
var logContainer = document.getElementById('log-container');
var statusDot = document.getElementById('status-dot');
var statusText = document.getElementById('status-text');
var autoScrollChk = document.getElementById('auto-scroll');
var ws;

function connect() {
  var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(protocol + '//' + window.location.host + '/logs');
  ws.onopen = function() {
    statusDot.className = 'status-dot connected';
    statusText.textContent = 'Connected';
  };
  ws.onmessage = function(event) { addLogLine(event.data); };
  ws.onclose = function() {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Disconnected — reconnecting...';
    setTimeout(connect, 2000);
  };
  ws.onerror = function() {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Error';
  };
}

function addLogLine(message) {
  var line = document.createElement('div');
  line.className = 'log-line';
  var match = message.match(/^\[(.+?)\]\s(.*)/);
  if (match) {
    var ts = document.createElement('span');
    ts.className = 'timestamp';
    ts.textContent = '[' + match[1] + '] ';
    var msg = document.createElement('span');
    msg.className = 'msg';
    msg.textContent = match[2];
    line.appendChild(ts);
    line.appendChild(msg);
    if (match[2].indexOf('disconnected') !== -1 || match[2].indexOf('Error') !== -1) {
      line.classList.add('error');
    } else if (match[2].indexOf('connected') !== -1 || match[2].indexOf('Connected') !== -1) {
      line.classList.add('info');
    } else {
      line.classList.add('event');
    }
  } else {
    var msg2 = document.createElement('span');
    msg2.className = 'msg';
    msg2.textContent = message;
    line.appendChild(msg2);
  }
  logContainer.appendChild(line);
  if (autoScrollChk.checked) { logContainer.scrollTop = logContainer.scrollHeight; }
}

function clearLogs() { logContainer.innerHTML = ''; }
connect();
</script>
</body>
</html>`;
