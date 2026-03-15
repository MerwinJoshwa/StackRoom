/**
 * preview-agent.js
 *
 * Serves the floating Gemini voice overlay that gets injected into
 * every preview page opened in a new tab.
 *
 * The overlay:
 *   1. Uses Web Speech API to transcribe mic audio in-browser
 *   2. POSTs the transcript to /api/rooms/:code/preview-agent
 *   3. Server calls Gemini with the command + all room files
 *   4. Gemini returns file edits → server applies them + re-runs project
 *   5. Server broadcasts file:change to StackRoom teammates
 *   6. Preview page auto-reloads when rebuild completes
 */

const OVERLAY_SCRIPT = `
(function() {
  if (window.__stackroomAgent) return;
  window.__stackroomAgent = true;

  // Extract room code from URL: /preview/ROOMCODE/...
  const roomMatch = location.pathname.match(/\\/preview\\/([A-Z0-9]+)/i);
  const roomCode  = roomMatch ? roomMatch[1].toUpperCase() : null;
  if (!roomCode) return;

  // ── Styles ──
  const style = document.createElement('style');
  style.textContent = \`
    #sr-agent {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      user-select: none;
    }
    #sr-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #0f1117;
      border: 1px solid #1e2330;
      border-radius: 999px;
      padding: 10px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: #e2e8f0;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      transition: background 0.15s, border-color 0.15s;
      min-width: 120px;
      justify-content: center;
    }
    #sr-pill:hover { background: #1a1e2b; border-color: #2a3045; }
    #sr-pill.listening { background: #0f1117; border-color: #00e5ff; }
    #sr-pill.processing { background: #0f1117; border-color: #a855f7; }
    #sr-pill.success { background: #0f1117; border-color: #10b981; }
    #sr-pill.error-state { background: #0f1117; border-color: #ef4444; }
    #sr-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #64748b;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    #sr-pill.listening  #sr-dot { background: #00e5ff; animation: sr-pulse 1s ease-in-out infinite; }
    #sr-pill.processing #sr-dot { background: #a855f7; animation: sr-pulse 0.7s ease-in-out infinite; }
    #sr-pill.success    #sr-dot { background: #10b981; }
    #sr-pill.error-state #sr-dot { background: #ef4444; }
    @keyframes sr-pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.5; transform: scale(1.3); }
    }
    #sr-panel {
      position: absolute;
      bottom: 52px;
      right: 0;
      width: 300px;
      background: #0f1117;
      border: 1px solid #1e2330;
      border-radius: 12px;
      padding: 14px;
      display: none;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    }
    #sr-panel.open { display: flex; }
    #sr-panel-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
    }
    #sr-status {
      font-size: 12px;
      color: #94a3b8;
      min-height: 18px;
      line-height: 1.4;
    }
    #sr-transcript {
      font-size: 12px;
      color: #00e5ff;
      min-height: 16px;
      font-style: italic;
    }
    #sr-last {
      font-size: 11px;
      color: #10b981;
      min-height: 14px;
      border-top: 1px solid #1e2330;
      padding-top: 8px;
    }
    #sr-text-row {
      display: flex;
      gap: 6px;
    }
    #sr-text-input {
      flex: 1;
      background: #13161d;
      border: 1px solid #1e2330;
      border-radius: 6px;
      padding: 7px 10px;
      color: #e2e8f0;
      font-size: 12px;
      outline: none;
    }
    #sr-text-input:focus { border-color: #00e5ff; }
    #sr-text-btn {
      background: #00e5ff;
      color: #0a0c10;
      border: none;
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    #sr-text-btn:disabled { opacity: 0.4; cursor: default; }
    #sr-reload-bar {
      display: none;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #10b981;
    }
    #sr-reload-bar.visible { display: flex; }
    #sr-spinner {
      width: 10px; height: 10px;
      border: 1.5px solid #10b981;
      border-top-color: transparent;
      border-radius: 50%;
      animation: sr-spin 0.7s linear infinite;
    }
    @keyframes sr-spin { to { transform: rotate(360deg); } }
  \`;
  document.head.appendChild(style);

  // ── DOM ──
  const root = document.createElement('div');
  root.id = 'sr-agent';
  root.innerHTML = \`
    <div id="sr-panel">
      <div id="sr-panel-title">✦ Gemini Preview Agent</div>
      <div id="sr-status">Tap the mic to speak a UI change</div>
      <div id="sr-transcript"></div>
      <div id="sr-text-row">
        <input id="sr-text-input" placeholder="Or type a command…" />
        <button id="sr-text-btn">↑</button>
      </div>
      <div id="sr-reload-bar">
        <div id="sr-spinner"></div>
        <span id="sr-reload-msg">Applying changes…</span>
      </div>
      <div id="sr-last"></div>
    </div>
    <div id="sr-pill">
      <span id="sr-dot"></span>
      <span id="sr-label">✦ Gemini</span>
    </div>
  \`;
  document.body.appendChild(root);

  const pill       = document.getElementById('sr-pill');
  const panel      = document.getElementById('sr-panel');
  const statusEl   = document.getElementById('sr-status');
  const transcriptEl = document.getElementById('sr-transcript');
  const lastEl     = document.getElementById('sr-last');
  const textInput  = document.getElementById('sr-text-input');
  const textBtn    = document.getElementById('sr-text-btn');
  const reloadBar  = document.getElementById('sr-reload-bar');
  const reloadMsg  = document.getElementById('sr-reload-msg');
  const label      = document.getElementById('sr-label');

  let panelOpen = false;
  let isProcessing = false;
  let recognition = null;

  function setState(state, msg) {
    pill.className = state;
    if (msg) statusEl.textContent = msg;
    if (state === 'listening') label.textContent = '⏹ Stop';
    else if (state === 'processing') label.textContent = '⚙ Thinking…';
    else label.textContent = '✦ Gemini';
  }

  pill.addEventListener('click', () => {
    const s = pill.className;
    if (!panelOpen) { panel.classList.add('open'); panelOpen = true; return; }
    if (s === '' || s === 'success' || s === 'error-state') startListening();
    else if (s === 'listening') stopListening();
  });

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target) && panelOpen) {
      panel.classList.remove('open');
      panelOpen = false;
    }
  });

  // ── Speech Recognition ──
  function startListening() {
    if (isProcessing) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setState('error-state', 'Speech not supported — use the text input');
      return;
    }
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    let finalText = '';

    recognition.onstart = () => { setState('listening', '🎙 Listening…'); transcriptEl.textContent = ''; };

    recognition.onresult = (e) => {
      let interim = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else interim += t;
      }
      finalText = fin || interim;
      transcriptEl.textContent = finalText;
    };

    recognition.onend = () => {
      recognition = null;
      if (finalText.trim()) sendCommand(finalText.trim());
      else setState('', 'Tap mic to speak');
    };

    recognition.onerror = (e) => {
      recognition = null;
      if (e.error === 'no-speech') setState('', 'No speech — try again');
      else if (e.error === 'not-allowed') setState('error-state', 'Mic permission denied');
      else setState('error-state', 'Error: ' + e.error);
    };

    recognition.start();
  }

  function stopListening() {
    if (recognition) { recognition.stop(); recognition = null; }
  }

  // ── Text input ──
  textBtn.addEventListener('click', () => {
    const t = textInput.value.trim();
    if (t) { textInput.value = ''; sendCommand(t); }
  });
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const t = textInput.value.trim(); if (t) { textInput.value = ''; sendCommand(t); } }
  });

  // ── Poll until preview server responds, then reload ──
  // Used for React/Vite projects where rebuild takes time
  function pollAndReload(maxWait) {
    maxWait = maxWait || 90000;
    const start = Date.now();
    let dots = 0;
    const iv = setInterval(async () => {
      dots = (dots + 1) % 4;
      reloadMsg.textContent = 'Rebuilding' + '.'.repeat(dots + 1);
      try {
        const r = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
        if (r.ok) {
          clearInterval(iv);
          reloadMsg.textContent = 'Reloading…';
          setTimeout(() => location.reload(), 200);
        }
      } catch(_) {}
      if (Date.now() - start > maxWait) {
        clearInterval(iv);
        reloadMsg.textContent = 'Reload when ready ↑';
      }
    }, 1500);
  }

  // ── Send command to server ──
  async function sendCommand(command) {
    if (isProcessing) return;
    isProcessing = true;
    setState('processing', '⚙ Gemini is thinking…');
    transcriptEl.textContent = command;
    reloadBar.classList.remove('visible');

    try {
      const res = await fetch('/api/rooms/' + roomCode + '/preview-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();

      if (data.ok) {
        setState('success', '✓ ' + (data.summary || 'Done'));
        lastEl.textContent = '✓ ' + (data.summary || 'Changes applied');
        transcriptEl.textContent = '';
        reloadBar.classList.add('visible');

        if (data.reload === 'instant') {
          // Static project — files already on disk, just reload immediately
          reloadMsg.textContent = 'Reloading…';
          setTimeout(() => location.reload(), 300);
        } else {
          // React/Vite — poll until the preview responds, then reload
          reloadMsg.textContent = 'Rebuilding React app…';
          pollAndReload();
        }

      } else {
        setState('error-state', '✗ ' + (data.error || 'Failed'));
      }
    } catch (err) {
      setState('error-state', 'Network error: ' + err.message);
    }

    isProcessing = false;
  }

})();
`;

module.exports = { OVERLAY_SCRIPT };
