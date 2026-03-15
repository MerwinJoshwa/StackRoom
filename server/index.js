try { require('dotenv').config(); } catch(_) {}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { createProxyMiddleware } = require('http-proxy-middleware');
const archiver = require('archiver');
const https = require('https');
const { execCode } = require('./executor');
const { runProject, stopProject, getRunningInstance, hotUpdateFiles, isReactProject } = require('./runner');
const { testConnection, buildDbEnv, detectDbType } = require('./db-connector');
const { attachGeminiLive } = require('./gemini-live');
const { OVERLAY_SCRIPT } = require('./preview-agent');
const { parseGeminiJson } = require('./gemini-parse');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

const limiter = rateLimit({ windowMs: 60000, max: 200 });
app.use('/api/', limiter);

// ─── PREVIEW PROXY ───
// Proxies /preview/:code/* → running preview server, injects Gemini overlay into HTML
app.use('/preview/:code', (req, res, next) => {
  const code = req.params.code.toUpperCase();
  const instance = getRunningInstance(code);
  if (!instance) return res.status(404).send('No running project for room ' + code);

  // req.path is already relative to /preview/:code — e.g. '/' or '/static/app.js'
  const targetPath = req.path || '/';
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map|json|ts|jsx|tsx)$/i.test(targetPath);

  if (isAsset) {
    // Assets — proxy with no-cache headers so CSS/JS updates appear immediately
    return createProxyMiddleware({
      target: 'http://localhost:' + instance.previewPort,
      changeOrigin: true,
      pathRewrite: (path) => path.replace(new RegExp('^/preview/' + code, 'i'), '') || '/',
      on: {
        error: (err, req, res) => res.status(502).send('Asset proxy error: ' + err.message),
        proxyRes: (proxyRes) => {
          proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate';
          proxyRes.headers['pragma']  = 'no-cache';
          proxyRes.headers['expires'] = '0';
        }
      }
    })(req, res, next);
  }

  // HTML pages — fetch manually so we can inject the overlay script
  const reqOpts = {
    hostname: 'localhost',
    port: instance.previewPort,
    path: targetPath + (req.query && Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : ''),
    method: 'GET', // always GET for HTML pages
    headers: {
      // Only forward safe headers — strip anything that causes 400
      'accept': 'text/html,application/xhtml+xml,*/*',
      'accept-language': req.headers['accept-language'] || 'en-US,en',
      'user-agent': req.headers['user-agent'] || 'StackRoom-Proxy/1.0',
      'host': 'localhost:' + instance.previewPort,
    },
  };

  const proxyReq = http.request(reqOpts, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || '';

    if (!ct.includes('text/html')) {
      // Not HTML — stream through unchanged
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      return;
    }

    // Collect HTML body and inject overlay
    const chunks = [];
    proxyRes.on('data', chunk => chunks.push(chunk));
    proxyRes.on('end', () => {
      const html = Buffer.concat(chunks).toString('utf8');
      const overlay = `<script>\n${OVERLAY_SCRIPT}\n</script>`;
      const patched = html.includes('</body>')
        ? html.replace('</body>', overlay + '\n</body>')
        : html + '\n' + overlay;

        // Build clean response headers — disable all caching so edits appear immediately
      const outHeaders = {};
      if (proxyRes.headers['content-type']) outHeaders['content-type'] = proxyRes.headers['content-type'];
      if (proxyRes.headers['set-cookie'])   outHeaders['set-cookie']   = proxyRes.headers['set-cookie'];
      outHeaders['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
      outHeaders['pragma']        = 'no-cache';
      outHeaders['expires']       = '0';
      outHeaders['content-length'] = Buffer.byteLength(patched, 'utf8').toString();

      res.writeHead(proxyRes.statusCode || 200, outHeaders);
      res.end(patched);
    });
  });

  proxyReq.on('error', (err) => {
    res.status(502).send('Preview server error: ' + err.message);
  });

  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy();
    res.status(504).send('Preview server timeout');
  });

  proxyReq.end();
});

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createDefaultFiles() {
  return {
    'frontend/App.jsx': {
      content: `import React, { useState, useEffect } from 'react';
import './styles.css';

const App = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [posted, setPosted] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setData({ error: err.message });
    }
    setLoading(false);
  };

  const postData = async () => {
    if (!input.trim()) return;
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input })
    });
    const json = await res.json();
    setPosted(JSON.stringify(json, null, 2));
    setInput('');
    fetchData();
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="app">
      <h1>⬡ my-app</h1>
      <div className="card">
        <h2>GET /api/data</h2>
        {loading ? <p>Loading...</p> : <pre>{JSON.stringify(data, null, 2)}</pre>}
      </div>
      <div className="input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && postData()}
          placeholder="POST a message to backend..."
        />
        <button onClick={postData}>Send</button>
      </div>
      {posted && <div className="card"><h2>Response</h2><pre>{posted}</pre></div>}
      <button className="refresh" onClick={fetchData}>↻ Refresh</button>
    </div>
  );
};

export default App;`,
      language: 'jsx'
    },
    'frontend/styles.css': {
      content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0a0c10; color: #e2e8f0; font-family: 'Segoe UI', monospace; padding: 24px; }
.app { max-width: 640px; margin: 0 auto; }
h1 { color: #00e5ff; margin-bottom: 20px; font-size: 26px; letter-spacing: -0.5px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px; }
.card { background: #13161d; border: 1px solid #1e2330; border-radius: 8px; padding: 16px; margin-bottom: 14px; }
pre { font-size: 12px; line-height: 1.6; color: #a0aec0; white-space: pre-wrap; word-break: break-all; }
.input-row { display: flex; gap: 8px; margin-bottom: 10px; }
input { flex: 1; background: #13161d; border: 1px solid #1e2330; border-radius: 6px; padding: 9px 12px; color: #e2e8f0; font-size: 13px; }
input:focus { outline: none; border-color: #00e5ff; }
button { background: #00e5ff; color: #0a0c10; border: none; border-radius: 6px; padding: 9px 18px; font-weight: 700; font-size: 13px; cursor: pointer; transition: background .15s; }
button:hover { background: #33ecff; }
.refresh { background: #1e2330; color: #94a3b8; width: 100%; margin-top: 4px; }
.refresh:hover { background: #2a3045; color: #e2e8f0; }`,
      language: 'css'
    },
    'frontend/index.html': {
      content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>my-app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
      language: 'html'
    },
    'backend/server.js': {
      content: `const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/api', routes);

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});

module.exports = app;`,
      language: 'javascript'
    },
    'backend/routes.js': {
      content: `const express = require('express');
const router = express.Router();

let messages = [];

// GET /api/data
router.get('/data', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Hello from StackRoom backend!',
    count: messages.length,
    messages,
    timestamp: new Date().toISOString()
  });
});

// POST /api/data
router.post('/data', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const entry = { id: messages.length + 1, text: message, at: new Date().toISOString() };
  messages.push(entry);
  res.json({ status: 'created', entry, total: messages.length });
});

// DELETE /api/data
router.delete('/data', (req, res) => {
  messages = [];
  res.json({ status: 'cleared' });
});

module.exports = router;`,
      language: 'javascript'
    },
    'backend/database.js': {
      content: `// Simple in-memory store — swap for MongoDB/PostgreSQL in production
class Database {
  constructor() { this.store = {}; }
  async connect() { console.log('[DB] In-memory store ready'); return this; }
  async get(key) { return this.store[key] ?? null; }
  async set(key, value) { this.store[key] = value; return value; }
  async delete(key) { delete this.store[key]; }
  async keys() { return Object.keys(this.store); }
}
module.exports = new Database();`,
      language: 'javascript'
    },
    'package.json': {
      content: JSON.stringify({
        name: 'my-app',
        version: '1.0.0',
        scripts: { start: 'node backend/server.js' },
        dependencies: { express: '^4.18.2', cors: '^2.8.5' }
      }, null, 2),
      language: 'json'
    }
  };
}

// ─── REST API ───

app.post('/api/rooms', (req, res) => {
  const { name, role, roomName } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'name and role required' });
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));
  const userId = uuidv4();
  const room = {
    id: uuidv4(), code,
    name: roomName || `room-${code.toLowerCase()}`,
    createdAt: Date.now(),
    files: createDefaultFiles(),
    chat: [{ id: uuidv4(), type: 'system', text: `Room ${code} created`, at: Date.now() }],
    users: {},
    db: null  // { connectionString, type, label, connectedAt }
  };
  room.users[userId] = { id: userId, name, role, online: true, joinedAt: Date.now() };
  rooms.set(code, room);
  res.json({ roomCode: code, userId, room: sanitizeRoom(room) });
});

app.post('/api/rooms/:code/join', (req, res) => {
  const { name, role } = req.body;
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const userId = uuidv4();
  room.users[userId] = { id: userId, name, role, online: true, joinedAt: Date.now() };
  room.chat.push({ id: uuidv4(), type: 'system', text: `${name} joined the room`, at: Date.now() });
  res.json({ userId, room: sanitizeRoom(room) });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(sanitizeRoom(room));
});

// ─── DOWNLOAD ROOM FILES AS ZIP ───
app.get('/api/rooms/:code/download', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const roomName = room.name.replace(/[^a-z0-9-_]/gi, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${roomName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => res.status(500).send(err.message));
  archive.pipe(res);

  for (const [filePath, file] of Object.entries(room.files)) {
    archive.append(file.content || '', { name: filePath });
  }

  archive.finalize();
});

// ─── UPLOAD FILES INTO ROOM ───
app.post('/api/rooms/:code/upload', express.json({ limit: '10mb' }), (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { files } = req.body;
  if (!files || typeof files !== 'object') return res.status(400).json({ error: 'files object required' });

  const LANG_MAP = {
    js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript',
    py:'python', java:'java', cpp:'cpp', css:'css', html:'html',
    json:'json', md:'markdown', sh:'sh', txt:'plaintext',
  };

  let count = 0;
  for (const [filePath, content] of Object.entries(files)) {
    const ext = filePath.split('.').pop().toLowerCase();
    const fileObj = { content, language: LANG_MAP[ext] || 'plaintext' };
    room.files[filePath] = fileObj;
    // Broadcast to all users in the room so files appear live
    io.to(req.params.code.toUpperCase()).emit('file:created', { filePath, file: fileObj });
    count++;
  }

  res.json({ ok: true, loaded: count, files: Object.keys(room.files) });
});

// ─── DATABASE LINK ENDPOINTS ───

// GET current DB config for room
app.get('/api/rooms/:code/db', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.db) return res.json({ connected: false });
  // Never return the raw connection string to the client — mask credentials
  const masked = maskConnectionString(room.db.connectionString);
  res.json({
    connected: true,
    type: room.db.type,
    label: room.db.label || masked,
    maskedUrl: masked,
    connectedAt: room.db.connectedAt,
    envVars: Object.keys(buildDbEnv(room.db)),
  });
});

// POST test + save DB connection
app.post('/api/rooms/:code/db', express.json(), async (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { connectionString, label } = req.body;
  if (!connectionString) return res.status(400).json({ error: 'connectionString required' });

  try {
    const result = await testConnection(connectionString);
    const type = detectDbType(connectionString);
    room.db = { connectionString, type, label: label || '', connectedAt: Date.now() };

    // Broadcast DB status update to all room members
    io.to(req.params.code.toUpperCase()).emit('db:connected', {
      type,
      label: label || maskConnectionString(connectionString),
      maskedUrl: maskConnectionString(connectionString),
      envVars: Object.keys(buildDbEnv(room.db)),
    });

    res.json({ ok: true, message: result.message, type, envVars: Object.keys(buildDbEnv(room.db)) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// DELETE — remove DB connection from room
app.delete('/api/rooms/:code/db', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  room.db = null;
  io.to(req.params.code.toUpperCase()).emit('db:disconnected', {});
  res.json({ ok: true });
});

// Helper — mask credentials in connection string for display
function maskConnectionString(str) {
  try {
    const url = new URL(str);
    if (url.password) url.password = '****';
    return url.toString();
  } catch (_) {
    return str.replace(/:([^@/]{3,})@/, ':****@');
  }
}

// ─── PREVIEW AGENT ───
// Called from the floating overlay in the preview tab
// Command + codebase → Gemini → file patches → re-run project → preview auto-reloads
app.post('/api/rooms/:code/preview-agent', express.json(), async (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });

  const { command } = req.body;
  if (!command?.trim()) return res.status(400).json({ ok: false, error: 'command required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY not set' });

  // Build codebase context
  const codebaseLines = [];
  for (const [filePath, file] of Object.entries(room.files)) {
    codebaseLines.push(`\n--- ${filePath} ---\n${file.content || ''}`);
  }
  const codebaseContext = codebaseLines.join('\n');

  const SYSTEM_PROMPT = `You are a UI editing agent inside StackRoom. The developer is viewing a live preview of their web app and giving you a voice command to change the UI.

Respond ONLY with a valid JSON object — no markdown, no explanation:
{
  "action": "edit",
  "files": [
    { "path": "frontend/App.jsx", "content": "...complete new file content..." }
  ],
  "summary": "one sentence describing what you changed"
}

Rules:
- Return ONLY the JSON, nothing else
- Return COMPLETE file content for every file you edit
- Focus on UI/visual changes (layout, position, color, size, text, style)
- Keep all existing functionality intact`;

  const userPrompt = `Voice command from developer viewing the live preview:\n"${command}"\n\nCurrent codebase:\n${codebaseContext}`;

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };

  try {
    // Call Gemini
    const geminiResponse = await new Promise((resolve, reject) => {
      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => { data += chunk; });
        apiRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) return reject(new Error('Empty Gemini response'));
            resolve(text);
          } catch (e) { reject(e); }
        });
      });
      apiReq.on('error', reject);
      apiReq.setTimeout(30000, () => { apiReq.destroy(); reject(new Error('Gemini timeout')); });
      apiReq.write(body);
      apiReq.end();
    });

    // Parse Gemini JSON response (bulletproof — handles markdown fences, prose, broken JSON)
    const parsed = parseGeminiJson(geminiResponse);

    if (parsed.action !== 'edit' || !Array.isArray(parsed.files)) {
      return res.json({ ok: false, error: 'Gemini did not return file edits' });
    }

    // Apply file edits to room
    const LANG_MAP = { js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', py:'python', css:'css', html:'html', json:'json' };
    const basenameMap = {};
    for (const p of Object.keys(room.files)) {
      basenameMap[p.toLowerCase()] = p;
      basenameMap[p.split('/').pop().toLowerCase()] = p;
    }

    const editedFiles = [];
    for (const fileEdit of parsed.files) {
      if (!fileEdit.path || typeof fileEdit.content !== 'string') continue;
      const normalized = fileEdit.path.replace(/\\/g, '/');
      const resolvedPath = basenameMap[normalized.toLowerCase()] || basenameMap[normalized.split('/').pop().toLowerCase()] || normalized;
      const ext = resolvedPath.split('.').pop().toLowerCase();
      room.files[resolvedPath] = { content: fileEdit.content, language: LANG_MAP[ext] || 'javascript' };
      // Broadcast to all StackRoom teammates
      io.to(roomCode).emit('file:change', { filePath: resolvedPath, content: fileEdit.content, source: 'preview-agent' });
      editedFiles.push(resolvedPath);
    }

    const summary = parsed.summary || `Edited ${editedFiles.join(', ')}`;

    // Notify StackRoom chat
    const chatMsg = { id: uuidv4(), type: 'system', text: `✦ Preview Agent: ${summary}`, at: Date.now() };
    room.chat.push(chatMsg);
    io.to(roomCode).emit('chat:message', chatMsg);
    io.to(roomCode).emit('gemini:edit', { summary, files: editedFiles, at: Date.now() });

    // Smart rebuild strategy:
    // Static HTML/CSS/JS → hot-update files on disk (instant, no restart)
    // React/Vite → full re-run (Vite picks up changes via HMR)
    const log = (type, text) => io.to(roomCode).emit('project:log', { type, text });
    const needsFullRebuild = isReactProject(room.files);

    if (!needsFullRebuild) {
      // ⭐ INSTANT: just write changed files to disk, static server serves them immediately
      const hotOk = hotUpdateFiles(roomCode, room.files);
      if (hotOk) {
        log('success', `Preview Agent: hot-updated ${editedFiles.join(', ')} (instant)`);
        res.json({ ok: true, summary, files: editedFiles, reload: 'instant' });
      } else {
        // No running instance — fallback to full run
        try {
          const result = await runProject(roomCode, room.files, log, room.db);
          io.to(roomCode).emit('project:ready', {
            url: `http://localhost:${result.previewPort}`,
            proxyUrl: `/preview/${roomCode}/`,
            backendPort: result.backendPort,
            previewPort: result.previewPort,
          });
          res.json({ ok: true, summary, files: editedFiles, reload: 'rebuild' });
        } catch (runErr) {
          res.json({ ok: true, summary, files: editedFiles, reload: 'instant', warn: runErr.message });
        }
      }
    } else {
      // React project: full rebuild needed
      log('cmd', `Preview Agent rebuilding React app...`);
      // Respond immediately so overlay shows success, rebuild happens async
      res.json({ ok: true, summary, files: editedFiles, reload: 'rebuild' });
      try {
        await stopProject(roomCode);
        const result = await runProject(roomCode, room.files, log, room.db);
        io.to(roomCode).emit('project:ready', {
          url: `http://localhost:${result.previewPort}`,
          proxyUrl: `/preview/${roomCode}/`,
          backendPort: result.backendPort,
          previewPort: result.previewPort,
        });
        log('success', 'Preview Agent: rebuild complete');
        // Broadcast reload signal so preview tab knows to refresh
        io.to(roomCode).emit('preview:reload', { at: Date.now() });
      } catch (runErr) {
        log('error', 'Preview Agent rebuild failed: ' + runErr.message);
      }
    }

  } catch (err) {
    console.error('[Preview Agent] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── AI AGENT ENDPOINT ───
// Uses Gemini 3 Flash for code generation
app.post('/api/ai', async (req, res) => {
  const { mode, code, filename, instruction, errorLog, allFiles } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not set on server.' });
  }

  // Build system prompt based on mode
  const systemPrompt = `You are an expert coding assistant embedded inside StackRoom, a collaborative IDE.
You help developers write, fix, and understand code.
Always respond with clean, working code.
When returning code, wrap it in triple backticks with the language name.
Be concise and direct. No unnecessary explanations unless asked.
The current file is: ${filename || 'unknown'}`;

  // Build user message based on mode
  let userMessage = '';
  const codeBlock = code ? `\n\nCurrent file (${filename}):\n\`\`\`\n${code}\n\`\`\`` : '';

  if (mode === 'ask') {
    userMessage = `${instruction}${codeBlock}`;
  } else if (mode === 'generate') {
    userMessage = `Generate code for: ${instruction}\nFile: ${filename}${codeBlock}\n\nReturn the complete updated file content.`;
  } else if (mode === 'fix') {
    userMessage = `Fix this error in my code:\n\nError:\n${errorLog}${codeBlock}\n\nReturn the fixed file content.`;
  } else if (mode === 'explain') {
    userMessage = `Explain what this code does in simple terms:${codeBlock}`;
  } else {
    userMessage = `${instruction}${codeBlock}`;
  }

  // Set up SSE streaming headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Use Google Gemini 3 Flash via generateContent (streaming)
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
  });

  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };

  const apiReq = https.request(options, (apiRes) => {
    apiRes.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') { res.write('data: [DONE]\n\n'); return; }
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
            if (parsed.candidates?.[0]?.finishReason === 'STOP') {
              res.write('data: [DONE]\n\n');
              res.end();
            }
          } catch (e) { /* skip */ }
        }
      }
    });
    apiRes.on('end', () => { if (!res.writableEnded) res.end(); });
    apiRes.on('error', (err) => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });
  });

  apiReq.on('error', (err) => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); });
  apiReq.write(body);
  apiReq.end();
});

app.post('/api/execute', async (req, res) => {
  const { language, code } = req.body;
  if (!language || !code) return res.status(400).json({ error: 'language and code required' });
  try {
    const result = await execCode(language, code);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeRoom(room) {
  return {
    id: room.id, code: room.code, name: room.name, createdAt: room.createdAt,
    files: room.files, chat: room.chat.slice(-100),
    users: Object.values(room.users)
  };
}

// ─── SOCKET.IO ───
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('room:join', ({ roomCode, userId }) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    const user = room.users[userId];
    if (!user) return socket.emit('error', { message: 'User not found' });
    currentRoom = roomCode;
    currentUser = userId;
    user.socketId = socket.id;
    user.online = true;
    socket.join(roomCode);
    socket.to(roomCode).emit('user:joined', { user });
    io.to(roomCode).emit('users:update', Object.values(room.users));
  });

  socket.on('file:change', ({ roomCode, filePath, content }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (!room.files[filePath]) room.files[filePath] = { content: '', language: 'javascript' };
    room.files[filePath].content = content;
    socket.to(roomCode).emit('file:change', { filePath, content });
  });

  socket.on('cursor:move', ({ roomCode, userId, filePath, line, col }) => {
    socket.to(roomCode).emit('cursor:move', { userId, filePath, line, col });
  });

  socket.on('chat:send', ({ roomCode, userId, text }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const user = room.users[userId];
    if (!user) return;
    const msg = { id: uuidv4(), type: 'user', userId, author: user.name, role: user.role, text, at: Date.now() };
    room.chat.push(msg);
    io.to(roomCode).emit('chat:message', msg);
  });

  socket.on('chat:typing', ({ roomCode, userId, typing }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const user = room.users[userId];
    if (!user) return;
    socket.to(roomCode).emit('chat:typing', { userId, name: user.name, typing });
  });

  socket.on('file:create', ({ roomCode, filePath, language }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    room.files[filePath] = { content: '', language: language || 'javascript' };
    io.to(roomCode).emit('file:created', { filePath, file: room.files[filePath] });
  });

  socket.on('file:delete', ({ roomCode, filePath }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    delete room.files[filePath];
    io.to(roomCode).emit('file:deleted', { filePath });
  });

  // ─── REAL PROJECT RUNNER ───
  socket.on('project:run', async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const log = (type, text) => io.to(roomCode).emit('project:log', { type, text });

    try {
      log('cmd', 'Stopping any previous instance...');
      await stopProject(roomCode);
      log('cmd', 'Writing project files...');

      const result = await runProject(roomCode, room.files, log, room.db);

      if (result.error) {
        log('error', result.error);
        io.to(roomCode).emit('project:error', { message: result.error });
        return;
      }

      log('success', `Backend API running on :${result.backendPort}`);
      log('success', `Preview server on :${result.previewPort}`);
      log('success', `Open → http://localhost:${result.previewPort}`);

      io.to(roomCode).emit('project:ready', {
        url: `http://localhost:${result.previewPort}`,
        proxyUrl: `/preview/${roomCode}/`,
        backendPort: result.backendPort,
        previewPort: result.previewPort,
      });

      const sysMsg = {
        id: uuidv4(), type: 'system',
        text: `Project live → http://localhost:${result.previewPort}`,
        at: Date.now()
      };
      room.chat.push(sysMsg);
      io.to(roomCode).emit('chat:message', sysMsg);

    } catch (err) {
      log('error', 'Build failed: ' + err.message);
      io.to(roomCode).emit('project:error', { message: err.message });
    }
  });

  socket.on('project:stop', async ({ roomCode }) => {
    await stopProject(roomCode);
    io.to(roomCode).emit('project:stopped', {});
  });

  // ─── USER ACTIVE FILE BROADCAST ───
  socket.on('user:activeFile', ({ roomCode, userId: uid, activeFile }) => {
    socket.to(roomCode).emit('user:activeFile', { userId: uid, activeFile });
  });

  // ─── SPECTATE ───
  // Viewer requests to watch a target user
  socket.on('spectate:request', ({ roomCode, viewerId, targetUserId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const targetUser = room.users[targetUserId];
    if (!targetUser || !targetUser.socketId) return;
    // Relay request to target user's socket — they will respond with their file snapshot
    io.to(targetUser.socketId).emit('spectate:request', { viewerId, roomCode });
  });

  // Target user responds with file snapshot
  socket.on('spectate:respond', ({ roomCode, viewerId, files, activeFile }) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const viewerUser = room.users[viewerId];
    if (!viewerUser || !viewerUser.socketId) return;
    io.to(viewerUser.socketId).emit('spectate:snapshot', { files, activeFile });
  });

  socket.on('spectate:stop', ({ roomCode, viewerId }) => {
    // Just acknowledged — no server-side state needed
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !currentUser) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const user = room.users[currentUser];
    if (user) { user.online = false; user.socketId = null; }
    io.to(currentRoom).emit('user:left', { userId: currentUser });
    io.to(currentRoom).emit('users:update', Object.values(room.users));
    const sysMsg = { id: uuidv4(), type: 'system', text: `${user?.name || 'A user'} left the room`, at: Date.now() };
    if (room.chat) { room.chat.push(sysMsg); io.to(currentRoom).emit('chat:message', sysMsg); }
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) { stopProject(code); rooms.delete(code); }
  }
}, 30 * 60 * 1000);

// ─── GEMINI LIVE ───
// Attach after server is created so WebSocket shares the same HTTP server
attachGeminiLive(server, io, rooms);

// In production (Cloud Run), serve the built React client
const path = require('path');
const publicPath = path.join(__dirname, 'public');
if (require('fs').existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    // Don't intercept API or socket routes
    if (req.path.startsWith('/api') || req.path.startsWith('/preview') || req.path.startsWith('/socket.io') || req.path.startsWith('/gemini-live')) return;
    res.sendFile(path.join(publicPath, 'index.html'));
  });
  console.log('[StackRoom] Serving built client from /public');
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`StackRoom server running on http://localhost:${PORT}`);
});
