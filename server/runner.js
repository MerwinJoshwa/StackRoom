/**
 * runner.js — StackRoom v3
 * Windows-compatible: uses npm.cmd / npx.cmd on Windows
 * React/JSX → Vite dev server | Plain HTML → Express static
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const express = require('express');
const http    = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { buildDbEnv } = require('./db-connector');

// Windows needs .cmd suffix for npm/npx
const isWindows = process.platform === 'win32';
const NPM = isWindows ? 'npm.cmd'  : 'npm';
const NPX = isWindows ? 'npx.cmd'  : 'npx';

const roomDbConfigs = new Map();
function setRoomDb(roomCode, dbConfig) {
  if (dbConfig) roomDbConfigs.set(roomCode, dbConfig);
  else roomDbConfigs.delete(roomCode);
}

const running = new Map();

let nextPort = 5100;
function allocPort() {
  const p = nextPort;
  nextPort += 2;
  if (nextPort > 5900) nextPort = 5100;
  return p;
}

// ─── Write room files to tmp disk ───
function writeFiles(roomCode, files) {
  const tmpDir = path.join(os.tmpdir(), `stackroom_run_${roomCode}`);
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const [filePath, file] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content || '', 'utf8');
  }
  return tmpDir;
}

// ─── Detect backend entry file ───
function detectBackend(tmpDir, files) {
  const backendFiles = Object.keys(files).filter(f => f.startsWith('backend/'));
  const byExt = {};
  for (const f of backendFiles) {
    const ext = f.split('.').pop().toLowerCase();
    if (!byExt[ext]) byExt[ext] = [];
    byExt[ext].push(f);
  }
  const langConfig = [
    { ext: 'js',   lang: 'node',   patterns: ['listen(', 'createServer', 'express()'] },
    { ext: 'py',   lang: 'python', patterns: ['app.run', 'uvicorn', 'if __name__', 'flask', 'fastapi'] },
    { ext: 'java', lang: 'java',   patterns: ['public static void main', 'SpringApplication'] },
    { ext: 'ts',   lang: 'node',   patterns: ['listen(', 'createServer'] },
  ];
  for (const { ext, lang, patterns } of langConfig) {
    const candidates = byExt[ext];
    if (!candidates?.length) continue;
    let best = null, bestScore = -1;
    for (const filePath of candidates) {
      const fullPath = path.join(tmpDir, filePath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
      let score = 0;
      for (const p of patterns) if (content.includes(p.toLowerCase())) score++;
      const name = filePath.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
      if (['server','index','app','main','api'].includes(name)) score += 2;
      if (score > bestScore) { bestScore = score; best = filePath; }
    }
    if (!best) best = candidates[0];
    return { lang, entryPath: best, fullPath: path.join(tmpDir, best) };
  }
  return null;
}

// ─── Detect npm-based React project (needs Vite) ───
// CDN React (unpkg/jsdelivr) = plain HTML, no Vite needed
function isReactProject(files) {
  const keys = Object.keys(files);
  const hasJsx = keys.some(f => f.endsWith('.jsx') || f.endsWith('.tsx'));
  if (!hasJsx) return false;
  // If any file loads React from a CDN, treat as static HTML
  const isCdn = keys.some(f => {
    const c = files[f]?.content || '';
    return c.includes('unpkg.com/react') || c.includes('cdn.jsdelivr.net') ||
           c.includes('cdnjs.cloudflare.com/ajax/libs/react') || c.includes('skypack.dev');
  });
  if (isCdn) return false;
  // Must actually use ES imports
  return keys.some(f => {
    if (!/\.(jsx?|tsx?)$/.test(f)) return false;
    const c = files[f]?.content || '';
    return c.includes("import React") || c.includes("from 'react'") ||
           c.includes('from "react"') || c.includes("from 'react-dom'") ||
           c.includes('from "react-dom"');
  });
}

// ─── Wait for port to open ───
function waitForPort(port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const start = Date.now();
    function tryConnect() {
      const client = new net.Socket();
      client.setTimeout(500);
      client.connect(port, '127.0.0.1', () => { client.destroy(); resolve(); });
      client.on('error', () => {
        client.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Port ${port} not open after ${timeout}ms`));
        else setTimeout(tryConnect, 400);
      });
      client.on('timeout', () => {
        client.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Timeout on port ${port}`));
        else setTimeout(tryConnect, 400);
      });
    }
    tryConnect();
  });
}

// ─── npm install in a directory ───
function npmInstall(dir, log) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return resolve();
    log('cmd', `npm install in ${path.relative(process.cwd(), dir) || dir}/`);
    const proc = spawn(NPM, ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: dir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => { const l = d.toString().trim(); if (l) log('info', l); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => resolve());
    proc.on('error', err => reject(err));
  });
}

// ─── pip install ───
function pipInstall(dir, log) {
  return new Promise((resolve) => {
    const reqFile = path.join(dir, 'backend', 'requirements.txt');
    if (!fs.existsSync(reqFile)) return resolve();
    log('cmd', 'pip install -r requirements.txt');
    const proc = spawn('pip3', ['install', '-r', reqFile, '--quiet'], {
      cwd: dir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => { const l = d.toString().trim(); if (l) log('info', l); });
    proc.stderr.on('data', d => { const l = d.toString().trim(); if (l) log('warn', l); });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

// ─── Start Node backend ───
function startNodeBackend(entryFullPath, backendDir, backendPort, log, dbEnv = {}) {
  log('cmd', `node ${path.basename(entryFullPath)}`);
  const proc = spawn('node', [entryFullPath], {
    cwd: backendDir,  // run from its own dir so require() resolves node_modules
    env: { ...process.env, ...dbEnv, PORT: String(backendPort), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('success', l)));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => {
    if (!l.includes('DeprecationWarning') && !l.includes('ExperimentalWarning')) log('warn', l);
  }));
  proc.on('close', code => { if (code !== null && code !== 0) log('error', `Node exited ${code}`); });
  proc.on('error', err => log('error', 'Node error: ' + err.message));
  return proc;
}

// ─── Start Python backend ───
function startPythonBackend(entryFullPath, backendPort, log, dbEnv = {}) {
  log('cmd', `python3 ${path.basename(entryFullPath)}`);
  const proc = spawn('python3', [entryFullPath], {
    cwd: path.dirname(entryFullPath),
    env: { ...process.env, ...dbEnv, PORT: String(backendPort), FLASK_ENV: 'development', FLASK_RUN_PORT: String(backendPort), PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('success', l)));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('warn', l)));
  proc.on('close', code => { if (code !== null && code !== 0) log('error', `Python exited ${code}`); });
  proc.on('error', err => log('error', 'Python error: ' + err.message));
  return proc;
}

// ─── Start Java backend ───
function startJavaBackend(entryFullPath, backendPort, log, dbEnv = {}) {
  return new Promise(async (resolve) => {
    log('cmd', `javac ${path.basename(entryFullPath)}`);
    const compileProc = spawn('javac', [entryFullPath], { cwd: path.dirname(entryFullPath), stdio: ['ignore','pipe','pipe'] });
    let compileErr = '';
    compileProc.stderr.on('data', d => { compileErr += d.toString(); });
    compileProc.on('close', code => {
      if (code !== 0) { log('error', 'Compile error:\n' + compileErr); resolve(null); return; }
      const className = path.basename(entryFullPath, '.java');
      log('cmd', `java ${className}`);
      const proc = spawn('java', [className], {
        cwd: path.dirname(entryFullPath),
        env: { ...process.env, ...dbEnv, PORT: String(backendPort) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('success', l)));
      proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('warn', l)));
      proc.on('close', code => { if (code && code !== 0) log('error', `Java exited ${code}`); });
      proc.on('error', err => log('error', 'Java error: ' + err.message));
      resolve(proc);
    });
    compileProc.on('error', () => { log('error', 'javac not found — install JDK'); resolve(null); });
  });
}

// ─── Find frontend dir ───
function findFrontendDir(tmpDir) {
  const d = path.join(tmpDir, 'frontend');
  return fs.existsSync(d) ? d : tmpDir;
}

// ─── Scaffold Vite for React project ───
function scaffoldViteFrontend(frontendDir, backendPort) {
  // vite.config.js
  if (!fs.existsSync(path.join(frontendDir, 'vite.config.js'))) {
    fs.writeFileSync(path.join(frontendDir, 'vite.config.js'),
`import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:${backendPort}' } },
  build: { outDir: 'dist' }
});
`);
  }
  // package.json
  const pkgPath = path.join(frontendDir, 'package.json');
  let pkg = { name:'frontend', version:'1.0.0', scripts:{ dev:'vite', build:'vite build' }, dependencies:{}, devDependencies:{} };
  if (fs.existsSync(pkgPath)) { try { pkg = JSON.parse(fs.readFileSync(pkgPath,'utf8')); } catch(e){} }
  pkg.scripts = { ...pkg.scripts, dev: 'vite', build: 'vite build' };
  pkg.dependencies  = pkg.dependencies  || {};
  pkg.devDependencies = pkg.devDependencies || {};
  if (!pkg.dependencies.react)          pkg.dependencies.react            = '^18.2.0';
  if (!pkg.dependencies['react-dom'])   pkg.dependencies['react-dom']     = '^18.2.0';
  if (!pkg.devDependencies['@vitejs/plugin-react']) pkg.devDependencies['@vitejs/plugin-react'] = '^4.2.0';
  if (!pkg.devDependencies.vite)        pkg.devDependencies.vite          = '^5.0.0';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  // index.html
  if (!fs.existsSync(path.join(frontendDir, 'index.html'))) {
    const entry = ['src/main.jsx','src/main.tsx','src/index.jsx','src/index.js','src/App.jsx']
      .find(f => fs.existsSync(path.join(frontendDir, f))) || 'src/index.js';
    fs.writeFileSync(path.join(frontendDir, 'index.html'),
`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>App</title></head><body><div id="root"></div><script type="module" src="/${entry}"></script></body></html>`);
  }
}

// ─── Start Vite dev server ───
function startViteDev(frontendDir, vitePort, log) {
  return new Promise(async (resolve) => {
    await npmInstall(frontendDir, log);
    log('cmd', `Starting Vite on :${vitePort}...`);
    const viteProc = spawn(NPX, ['vite', '--port', String(vitePort), '--host', '0.0.0.0', '--strictPort'], {
      cwd: frontendDir,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    viteProc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => log('info', l)));
    viteProc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => {
      if (!l.includes('ExperimentalWarning')) log('warn', l);
    }));
    viteProc.on('error', err => log('error', 'Vite error: ' + err.message));
    viteProc.on('close', code => { if (code && code !== 0) log('error', `Vite exited ${code}`); });
    resolve(viteProc);
  });
}

// ─── Main: run project ───
async function runProject(roomCode, files, log, dbConfig) {
  const backendPort = allocPort();
  const previewPort = backendPort + 1;

  log('info', 'Writing files to disk...');
  const tmpDir      = writeFiles(roomCode, files);
  const backend     = detectBackend(tmpDir, files);
  const frontendDir = findFrontendDir(tmpDir);
  const reactApp    = isReactProject(files);
  log('success', 'Files written');

  if (backend)  log('info', `Backend: ${backend.lang} → ${backend.entryPath}`);
  if (reactApp) log('info', 'React frontend → Vite');
  else          log('info', 'Static HTML frontend → Express');

  const resolvedDb = dbConfig || roomDbConfigs.get(roomCode);
  const dbEnv = resolvedDb ? buildDbEnv(resolvedDb) : {};

  // ── 1. Install + start backend ──
  let backendProc = null;
  if (backend?.lang === 'node') {
    const backendDir = path.dirname(backend.fullPath);
    // Patch package.json IN THE SAME DIR as the entry file
    const pkgPath = path.join(backendDir, 'package.json');
    let pkg = { name:'backend', version:'1.0.0', dependencies:{} };
    if (fs.existsSync(pkgPath)) { try { pkg = JSON.parse(fs.readFileSync(pkgPath,'utf8')); } catch(e){} }
    pkg.dependencies = pkg.dependencies || {};
    if (!pkg.dependencies.express) pkg.dependencies.express = '^4.18.2';
    if (!pkg.dependencies.cors)    pkg.dependencies.cors    = '^2.8.5';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    // Install into that same directory
    try { await npmInstall(backendDir, log); } catch(e) { log('warn', 'npm install error: ' + e.message); }

    backendProc = startNodeBackend(backend.fullPath, backendDir, backendPort, log, dbEnv);
  } else if (backend?.lang === 'python') {
    await pipInstall(tmpDir, log);
    backendProc = startPythonBackend(backend.fullPath, backendPort, log, dbEnv);
  } else if (backend?.lang === 'java') {
    backendProc = await startJavaBackend(backend.fullPath, backendPort, log, dbEnv);
  } else {
    log('info', 'No backend — frontend only.');
  }

  if (backendProc) {
    log('info', `Waiting for backend on :${backendPort}...`);
    try {
      await waitForPort(backendPort, 20000);
      log('success', `Backend up on :${backendPort}`);
    } catch (err) {
      log('warn', 'Backend slow to start — check your server code for errors.');
    }
  }

  // ── 2. Start frontend ──
  let frontendProc  = null;
  let previewServer = null;

  if (reactApp) {
    scaffoldViteFrontend(frontendDir, backendPort);
    frontendProc = await startViteDev(frontendDir, previewPort, log);
    log('info', `Waiting for Vite on :${previewPort} (first run may take ~60s)...`);
    try {
      await waitForPort(previewPort, 90000);
      log('success', `React app live on :${previewPort}`);
    } catch(err) {
      log('error', 'Vite failed to start. See console above for errors.');
    }
  } else {
    // Static file server — find index.html wherever it is
    const indexCandidates = [
      path.join(frontendDir, 'index.html'),
      path.join(frontendDir, 'public', 'index.html'),
      path.join(frontendDir, 'src', 'index.html'),
    ];
    let indexHtmlPath = indexCandidates.find(c => fs.existsSync(c)) || path.join(frontendDir, 'index.html');
    const serveDir = path.dirname(indexHtmlPath);

    // Auto-generate fallback index.html
    if (!fs.existsSync(indexHtmlPath)) {
      const listed = Object.keys(files).filter(f =>
        f.startsWith('frontend/') && (f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.css'))
      );
      fs.writeFileSync(indexHtmlPath,
`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>StackRoom Preview</title>
<style>body{background:#0a0c10;color:#e2e8f0;font-family:monospace;padding:24px}.info{color:#00e5ff}.card{background:#13161d;border:1px solid #1e2330;border-radius:8px;padding:16px;margin-top:12px}.file{color:#10b981;font-size:12px;margin:4px 0}</style>
</head><body><div class="info">⬡ StackRoom${backend?' — '+backend.lang+' backend on :'+backendPort:''}</div>
<div class="card">${listed.map(f=>`<div class="file">📄 ${f}</div>`).join('')}
<p style="color:#64748b;font-size:11px;margin-top:8px">Add a <b>frontend/index.html</b> to see your UI.${backend?`<br>API → <a href="/api" style="color:#00e5ff">/api</a>`:''}</p></div>
</body></html>`);
    }

    const previewApp = express();
    if (backendProc) {
      previewApp.use('/api', createProxyMiddleware({
        target: `http://localhost:${backendPort}`, changeOrigin: true,
        on: { error: (err, req, res) => res.status(502).json({ error: 'Backend unavailable' }) }
      }));
    }
    // maxAge: 0 = no caching, so hot-updated files are always served fresh
    const staticOpts = { index: 'index.html', etag: false, lastModified: false, setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }};
    previewApp.use(express.static(serveDir,    staticOpts));
    previewApp.use(express.static(frontendDir, staticOpts));
    previewApp.use(express.static(tmpDir,      staticOpts));
    previewApp.get('*', (req, res) => {
      if (fs.existsSync(indexHtmlPath)) res.sendFile(indexHtmlPath);
      else res.status(404).send('No index.html found');
    });
    previewServer = http.createServer(previewApp);
    await new Promise((resolve, reject) => {
      previewServer.listen(previewPort, '0.0.0.0', resolve);
      previewServer.on('error', reject);
    });
    log('success', `Static preview on :${previewPort}`);
  }

  running.set(roomCode, { backendProc, frontendProc, previewServer, backendPort, previewPort, tmpDir });
  return { backendPort, previewPort };
}

// ─── Stop project ───
async function stopProject(roomCode) {
  const instance = running.get(roomCode);
  if (!instance) return;
  if (instance.backendProc)  { try { instance.backendProc.kill('SIGTERM');  } catch(_){} }
  if (instance.frontendProc) { try { instance.frontendProc.kill('SIGTERM'); } catch(_){} }
  if (instance.previewServer) {
    await new Promise(resolve => instance.previewServer.close(resolve));
  }
  if (instance.tmpDir && fs.existsSync(instance.tmpDir)) {
    try { fs.rmSync(instance.tmpDir, { recursive: true, force: true }); } catch(_){} 
  }
  running.delete(roomCode);
}

// ─── Hot-update files on disk without restarting ───
// Used by preview-agent for static HTML projects — instant, no rebuild needed
function hotUpdateFiles(roomCode, files) {
  const instance = running.get(roomCode);
  if (!instance || !instance.tmpDir) return false;
  if (!fs.existsSync(instance.tmpDir)) return false;
  for (const [filePath, file] of Object.entries(files)) {
    const fullPath = path.join(instance.tmpDir, filePath);
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, file.content || '', 'utf8');
    } catch(e) {
      console.error('[HotUpdate] Failed to write', filePath, e.message);
    }
  }
  return true;
}

module.exports = { runProject, stopProject, getRunningInstance: (code) => running.get(code), setRoomDb, hotUpdateFiles, isReactProject };
