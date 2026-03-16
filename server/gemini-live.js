/**
 * gemini-live.js — StackRoom Voice Director
 *
 * Uses Gemini Live API (BidiGenerateContent) for real-time voice sessions.
 * Falls back to standard REST generateContent if Live API is unavailable.
 *
 * Live API: wss://generativelanguage.googleapis.com/ws/
 *           google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent
 * Model:    models/gemini-2.0-flash-exp  (confirmed working on v1alpha)
 * Fallback: models/gemini-2.5-flash via REST generateContent
 */

const WebSocket = require('ws');
const https = require('https');
const { parseGeminiJson } = require('./gemini-parse');

const sessions = new Map();

const SYSTEM_PROMPT = `You are an AI coding assistant embedded in StackRoom, a real-time collaborative IDE.
The developer gives you a voice or text instruction. You edit their code directly.

Respond with ONLY a valid JSON object in this exact format — no markdown, no backticks, no explanation:
{
  "action": "edit",
  "files": [
    {
      "path": "frontend/index.html",
      "content": "...complete new file content..."
    }
  ],
  "summary": "one sentence describing what you changed"
}

CRITICAL file path rules — you MUST follow these exactly:
- ALL frontend files (HTML, CSS, JS, JSX, images) MUST use path prefix: frontend/
  Examples: frontend/index.html, frontend/style.css, frontend/app.js, frontend/App.jsx
- ALL backend files (server, routes, API) MUST use path prefix: backend/
  Examples: backend/server.js, backend/routes.js, backend/app.py
- NEVER use bare filenames without a folder prefix
- NEVER use src/, public/, or any other prefix — only frontend/ or backend/

Other rules:
- Return ONLY the JSON object, nothing else
- Always return the COMPLETE file content for each file you edit
- You can edit multiple files in one response
- Keep all existing functionality unless explicitly told to remove it
- Interpret the developer's intent naturally`;

// ─── REST fallback (gemini-2.5-flash) ───
function callGeminiRest(apiKey, userText, codebaseContext) {
  return new Promise((resolve, reject) => {
    const prompt = `${userText}\n\nCurrent codebase:\n${codebaseContext}`;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
    });
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) return reject(new Error('Empty response from Gemini'));
          resolve(text);
        } catch (e) { reject(new Error('Failed to parse Gemini response: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Gemini request timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── Gemini Live API session ───
// Uses BidiGenerateContent WebSocket for real-time bidirectional voice streaming
class GeminiLiveSession {
  constructor(apiKey, roomCode, room, io, clientWs) {
    this.apiKey    = apiKey;
    this.roomCode  = roomCode;
    this.room      = room;
    this.io        = io;
    this.clientWs  = clientWs;
    this.geminiWs  = null;
    this.ready     = false;
    this.textBuffer = '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
      console.log(`[GeminiLive] Connecting to Live API for room ${this.roomCode}...`);

      this.geminiWs = new WebSocket(url);

      const timeout = setTimeout(() => {
        if (!this.ready) {
          this.geminiWs?.close();
          reject(new Error('Live API connection timeout'));
        }
      }, 15000);

      this.geminiWs.on('open', () => {
        console.log(`[GeminiLive] Connected — sending setup for room ${this.roomCode}`);
        // Send setup message to initialize the Live API session
        this.geminiWs.send(JSON.stringify({
          setup: {
            model: 'models/gemini-2.0-flash-exp',
            generationConfig: {
              responseModalities: 'text',
              temperature: 0.3,
            },
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }]
            }
          }
        }));
      });

      this.geminiWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Setup complete — Live API is ready
          if (msg.setupComplete !== undefined) {
            console.log(`[GeminiLive] ✓ Setup complete — room ${this.roomCode}`);
            this.ready = true;
            clearTimeout(timeout);
            resolve(true);
            return;
          }

          // Streaming text response from Live API
          const parts = msg.serverContent?.modelTurn?.parts;
          if (parts) {
            for (const part of parts) {
              if (part.text) this.textBuffer += part.text;
            }
          }

          // Turn complete — process the full response
          if (msg.serverContent?.turnComplete) {
            const fullText = this.textBuffer.trim();
            this.textBuffer = '';
            if (fullText) {
              console.log(`[GeminiLive] Turn complete — processing response for room ${this.roomCode}`);
              processGeminiResponse(fullText, this.roomCode, this.room, this.io, this.clientWs);
            }
          }

        } catch (e) {
          console.error(`[GeminiLive] Message parse error:`, e.message);
        }
      });

      this.geminiWs.on('error', (err) => {
        console.error(`[GeminiLive] WebSocket error for room ${this.roomCode}:`, err.message);
        clearTimeout(timeout);
        if (!this.ready) reject(err);
      });

      this.geminiWs.on('close', (code, reason) => {
        console.log(`[GeminiLive] Closed — code: ${code}, reason: ${reason?.toString()}`);
        this.ready = false;
        clearTimeout(timeout);
        if (!this.ready) reject(new Error(`Live API closed: ${code} ${reason?.toString()}`));
      });
    });
  }

  // Send a text message through the Live API
  sendText(text, codebaseContext) {
    if (!this.ready || !this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) {
      return false;
    }
    const fullPrompt = `${text}\n\nCurrent codebase:\n${codebaseContext}`;
    this.geminiWs.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        turnComplete: true
      }
    }));
    return true;
  }

  close() {
    this.ready = false;
    if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
      try { this.geminiWs.close(); } catch (_) {}
    }
  }
}

// ─── Process Gemini response → apply file edits ───
function processGeminiResponse(rawText, roomCode, room, io, clientWs) {
  try {
    const parsed = parseGeminiJson(rawText);

    if (parsed.action === 'edit' && Array.isArray(parsed.files)) {
      const editedFiles = [];
      const LANG_MAP = {
        js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript',
        py:'python', css:'css', html:'html', json:'json', java:'java', md:'markdown'
      };

      // Build basename → full path lookup
      const existingPaths = Object.keys(room.files);
      const basenameMap = {};
      for (const p of existingPaths) {
        basenameMap[p.split('/').pop().toLowerCase()] = p;
        basenameMap[p.toLowerCase()] = p;
      }

      for (const fileEdit of parsed.files) {
        if (!fileEdit.path || typeof fileEdit.content !== 'string') continue;
        const normalized = fileEdit.path.replace(/\\/g, '/');
        let resolvedPath =
          basenameMap[normalized.toLowerCase()] ||
          basenameMap[normalized.split('/').pop().toLowerCase()] ||
          normalized;

        // If Gemini returned a bare filename with no folder prefix,
        // assign it to the correct folder based on file type
        if (!resolvedPath.includes('/')) {
          const ext = resolvedPath.split('.').pop().toLowerCase();
          const frontendExts = ['html', 'css', 'jsx', 'tsx', 'js', 'ts', 'svg', 'png'];
          const backendExts  = ['py', 'java', 'rb', 'go', 'php'];
          if (frontendExts.includes(ext)) {
            resolvedPath = 'frontend/' + resolvedPath;
          } else if (backendExts.includes(ext)) {
            resolvedPath = 'backend/' + resolvedPath;
          } else if (ext === 'js' || ext === 'ts') {
            resolvedPath = 'backend/' + resolvedPath;
          }
        }

        const ext = resolvedPath.split('.').pop().toLowerCase();
        room.files[resolvedPath] = {
          content: fileEdit.content,
          language: LANG_MAP[ext] || 'javascript'
        };
        io.to(roomCode).emit('file:change', {
          filePath: resolvedPath,
          content: fileEdit.content,
          source: 'gemini-live'
        });
        editedFiles.push(resolvedPath);
      }

      const summary = parsed.summary || `Edited ${editedFiles.join(', ')}`;
      clientWs.send(JSON.stringify({ type: 'edit-complete', summary, files: editedFiles }));
      io.to(roomCode).emit('gemini:edit', { summary, files: editedFiles, at: Date.now() });
      console.log(`[GeminiLive] Applied edits to: ${editedFiles.join(', ')}`);
      console.log('[GeminiLive] Room files now:', Object.keys(room.files));

    } else {
      clientWs.send(JSON.stringify({
        type: 'message',
        text: parsed.summary || parsed.message || rawText.slice(0, 300)
      }));
    }
  } catch (e) {
    console.error('[GeminiLive] Parse error:', e.message, '| Raw:', rawText.slice(0, 200));
    clientWs.send(JSON.stringify({ type: 'message', text: rawText.slice(0, 500) }));
  }
}

// ─── Build compact codebase context ───
function buildCodebaseContext(files) {
  const lines = [];
  let totalChars = 0;
  const MAX = 10000;
  for (const [path, file] of Object.entries(files)) {
    const entry = `\n--- ${path} ---\n${file.content || ''}\n`;
    if (totalChars + entry.length > MAX) {
      lines.push('\n[...remaining files truncated for brevity...]');
      break;
    }
    lines.push(entry);
    totalChars += entry.length;
  }
  return lines.join('');
}

// ─── Attach WebSocket handler ───
function attachGeminiLive(server, io, rooms) {
  const wss = new WebSocket.Server({ server, path: '/gemini-live' });

  wss.on('connection', (clientWs, req) => {
    const url      = new URL(req.url, 'http://localhost');
    const roomCode = url.searchParams.get('room')?.toUpperCase();
    const userId   = url.searchParams.get('userId');

    if (!roomCode || !rooms.has(roomCode)) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
      clientWs.close();
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY not set on server' }));
      clientWs.close();
      return;
    }

    console.log(`[GeminiLive] Session started — room ${roomCode}`);

    let liveSession  = null;
    let isProcessing = false;
    let useLiveApi   = true; // try Live API first, fall back to REST

    // ── Try to connect to Gemini Live API ──
    async function initLiveSession() {
      try {
        liveSession = new GeminiLiveSession(apiKey, roomCode, rooms.get(roomCode), io, clientWs);
        await liveSession.connect();
        clientWs.send(JSON.stringify({
          type: 'ready',
          message: '🎙 Ready — powered by Gemini Live API'
        }));
        console.log(`[GeminiLive] Live API ready for room ${roomCode}`);
      } catch (err) {
        console.warn(`[GeminiLive] Live API failed (${err.message}) — falling back to REST`);
        useLiveApi = false;
        liveSession = null;
        clientWs.send(JSON.stringify({
          type: 'ready',
          message: '🎙 Ready — using Gemini REST API'
        }));
      }
    }

    initLiveSession();

    clientWs.on('message', async (data) => {
      if (isProcessing) return;

      try {
        const msg = JSON.parse(data.toString());
        const room = rooms.get(roomCode);
        if (!room) return;

        if (msg.type === 'text') {
          if (!msg.text?.trim()) return;
          isProcessing = true;
          clientWs.send(JSON.stringify({ type: 'status', message: '⚙ Gemini is thinking...' }));

          const codebaseContext = buildCodebaseContext(room.files);

          // Try Live API first
          if (useLiveApi && liveSession?.ready) {
            console.log(`[GeminiLive] Sending via Live API: "${msg.text}" — room ${roomCode}`);
            const sent = liveSession.sendText(msg.text, codebaseContext);
            if (!sent) {
              // Live API not ready, fall back to REST
              useLiveApi = false;
            }
            // Response comes asynchronously via the Live API message handler
            isProcessing = false;
            return;
          }

          // REST fallback
          try {
            console.log(`[GeminiLive] Sending via REST: "${msg.text}" — room ${roomCode} | files: ${Object.keys(room.files).join(', ')}`);
            const response = await callGeminiRest(apiKey, msg.text, codebaseContext);
            processGeminiResponse(response, roomCode, room, io, clientWs);
          } catch (err) {
            console.error('[GeminiLive] REST error:', err.message);
            clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
          }
          isProcessing = false;
        }

      } catch (_) {
        // ignore binary/non-JSON
      }
    });

    clientWs.on('close', () => {
      console.log(`[GeminiLive] Session ended — room ${roomCode}`);
      liveSession?.close();
      liveSession = null;
      sessions.delete(roomCode);
    });

    clientWs.on('error', (err) => {
      console.error(`[GeminiLive] Client WS error — room ${roomCode}:`, err.message);
    });

    sessions.set(roomCode, { clientWs, liveSession });
  });

  console.log('[GeminiLive] WebSocket handler attached at /gemini-live');
}

module.exports = { attachGeminiLive };
