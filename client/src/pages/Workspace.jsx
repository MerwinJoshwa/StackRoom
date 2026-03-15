import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar.jsx';
import FileExplorer from '../components/FileExplorer.jsx';
import EditorPane from '../components/EditorPane.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ConsolePanel from '../components/ConsolePanel.jsx';
import PreviewPanel from '../components/PreviewPanel.jsx';
import StatusBar from '../components/StatusBar.jsx';
import SpectatePanel from '../components/SpectatePanel.jsx';
import AiPanel from '../components/AiPanel.jsx';
import DatabasePanel from '../components/DatabasePanel.jsx';
import VoiceDirector from '../components/VoiceDirector.jsx';
import styles from './Workspace.module.css';

export default function Workspace({ session, onLeave }) {
  const { roomCode, userId, userName, userRole } = session;

  const [users, setUsers]               = useState(session.room.users || []);
  const [files, setFiles]               = useState(session.room.files || {});
  const [activeFile, setActiveFile]     = useState(Object.keys(session.room.files)[0] || 'frontend/App.jsx');
  const [chatMessages, setChatMessages] = useState(session.room.chat || []);
  const [consoleLogs, setConsoleLogs]   = useState([
    { type: 'info',    text: 'StackRoom v3 – Room ' + roomCode },
    { type: 'success', text: 'Logged in as ' + userName + ' · ' + userRole },
  ]);
  const [projectState, setProjectState] = useState('idle');
  const [previewUrl, setPreviewUrl]     = useState('');
  const [projectError, setProjectError] = useState('');
  const [typingUsers, setTypingUsers]   = useState({});
  const [remoteCursors, setRemoteCursors] = useState({});
  const [spectating, setSpectating]     = useState(null);
  const [spectateFiles, setSpectateFiles]   = useState({});
  const [spectateActive, setSpectateActive] = useState(null);
  const [bottomTab, setBottomTab]       = useState('console');
  const [rightTab, setRightTab]         = useState('chat');

  // Keep a ref to files so socket callbacks always see latest value
  const filesRef      = useRef(files);
  filesRef.current    = files;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;

  // Socket ref — one fresh socket per Workspace mount
  const socketRef = useRef(null);

  const addLog = useCallback((type, text) => {
    setConsoleLogs(prev => [...prev, { type, text, id: Date.now() + Math.random() }]);
  }, []);

  // ── Socket setup — runs once on mount, fully torn down on unmount ──
  useEffect(() => {
    // Create a fresh socket — always point explicitly at the backend
    // In dev Vite proxies /socket.io → localhost:4000
    // In prod the same origin serves everything
    const socket = io('/', {
      autoConnect: true,
      transports: ['polling', 'websocket'], // start with polling (always works), upgrade to ws
      forceNew: true,
      path: '/socket.io',
    });
    socketRef.current = socket;

    // ── Listeners ──
    socket.on('connect', () => {
      console.log('[Socket] connected', socket.id, '— joining room', roomCode);
      socket.emit('room:join', { roomCode, userId });
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] connect error:', err.message);
      addLog('error', 'Socket connect error: ' + err.message);
    });

    socket.on('users:update', (updatedUsers) => {
      console.log('[Socket] users:update', updatedUsers);
      setUsers(updatedUsers);
    });

    socket.on('user:joined', ({ user }) => {
      console.log('[Socket] user:joined', user);
      addLog('info', `${user.name} [${user.role}] joined`);
    });

    socket.on('user:left', ({ userId: uid }) => {
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, online: false } : u));
      setSpectating(s => s === uid ? null : s);
    });

    // File changes from teammates OR from Gemini (source: 'gemini-live')
    socket.on('file:change', ({ filePath, content, source }) => {
      console.log('[Socket] file:change', filePath, source || '');
      setFiles(prev => ({
        ...prev,
        [filePath]: { ...(prev[filePath] || {}), content }
      }));
      setSpectateFiles(prev =>
        prev[filePath] ? { ...prev, [filePath]: { ...prev[filePath], content } } : prev
      );
    });

    socket.on('file:created', ({ filePath, file }) => {
      setFiles(prev => ({ ...prev, [filePath]: file }));
    });

    socket.on('file:deleted', ({ filePath }) => {
      setFiles(prev => {
        const next = { ...prev };
        delete next[filePath];
        return next;
      });
      setActiveFile(f => f === filePath ? Object.keys(filesRef.current).find(k => k !== filePath) || '' : f);
    });

    socket.on('chat:message', (msg) => {
      console.log('[Socket] chat:message', msg);
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('chat:typing', ({ userId: uid, name, typing }) => {
      setTypingUsers(prev =>
        typing ? { ...prev, [uid]: name } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== uid))
      );
    });

    socket.on('cursor:move', ({ userId: uid, filePath, line, col }) => {
      setRemoteCursors(prev => ({ ...prev, [uid]: { filePath, line, col } }));
    });

    socket.on('spectate:snapshot', ({ files: sf, activeFile: sa }) => {
      setSpectateFiles(sf);
      setSpectateActive(sa);
    });

    socket.on('spectate:activeFile', ({ activeFile: sa }) => setSpectateActive(sa));

    socket.on('spectate:request', ({ viewerId }) => {
      socket.emit('spectate:respond', {
        roomCode, viewerId,
        files: filesRef.current,
        activeFile: activeFileRef.current,
      });
    });

    socket.on('db:connected',    (info) => addLog('success', `🗄 DB linked: ${info.type} — ${info.label || info.maskedUrl}`));
    socket.on('db:disconnected', ()     => addLog('info', 'Database disconnected from room'));

    socket.on('gemini:edit', ({ summary, files }) => {
      addLog('success', `✦ Gemini: ${summary}`);
      // If Gemini created/edited a file that isn't currently open, switch to it
      if (files?.length > 0) {
        const firstFile = files[0];
        setActiveFile(prev => {
          // Only switch if current file is unchanged or new file is more relevant
          if (!prev || prev === firstFile) return firstFile;
          return prev; // keep current file focused while editing
        });
      }
    });

    socket.on('project:log',     (log)        => addLog(log.type, log.text));
    socket.on('project:ready',   ({ url, proxyUrl }) => {
      setProjectState('ready');
      setPreviewUrl(proxyUrl || url);
      setProjectError('');
      setBottomTab('preview');
    });
    socket.on('project:error',   ({ message }) => {
      setProjectState('error');
      setProjectError(message);
      addLog('error', 'Build failed: ' + message);
    });
    socket.on('project:stopped', ()           => { setProjectState('idle'); setPreviewUrl(''); });
    socket.on('error',           ({ message }) => addLog('error', message));

    // ── Teardown ──
    return () => {
      console.log('[Socket] disconnecting');
      socket.disconnect();
      socket.removeAllListeners();
      socketRef.current = null;
    };
  }, [roomCode, userId]); // only re-run if room/user changes

  // Broadcast active file changes
  useEffect(() => {
    socketRef.current?.emit('user:activeFile', { roomCode, userId, activeFile });
  }, [activeFile, roomCode, userId]);

  // ── Handlers ──
  const handleFileChange = useCallback((filePath, content) => {
    setFiles(prev => ({ ...prev, [filePath]: { ...prev[filePath], content } }));
    socketRef.current?.emit('file:change', { roomCode, filePath, content });
  }, [roomCode]);

  const handleCreateFile = useCallback((filePath, language) => {
    socketRef.current?.emit('file:create', { roomCode, filePath, language });
  }, [roomCode]);

  const handleDeleteFile = useCallback((filePath) => {
    socketRef.current?.emit('file:delete', { roomCode, filePath });
  }, [roomCode]);

  const handleCursorMove = useCallback((filePath, line, col) => {
    socketRef.current?.emit('cursor:move', { roomCode, userId, filePath, line, col });
  }, [roomCode, userId]);

  const handleSendChat = useCallback((text) => {
    console.log('[Chat] sending', text, 'as', userId);
    socketRef.current?.emit('chat:send', { roomCode, userId, text });
  }, [roomCode, userId]);

  const handleTyping = useCallback((typing) => {
    socketRef.current?.emit('chat:typing', { roomCode, userId, typing });
  }, [roomCode, userId]);

  const handleRunProject = useCallback(() => {
    if (projectState === 'running') return;
    if (projectState === 'ready') {
      socketRef.current?.emit('project:stop', { roomCode });
      setProjectState('idle');
      setPreviewUrl('');
      return;
    }
    setProjectState('running');
    setProjectError('');
    setConsoleLogs([{ type: 'cmd', text: 'Starting project build...' }]);
    setBottomTab('console');
    socketRef.current?.emit('project:run', { roomCode });
  }, [roomCode, projectState]);

  const handleExecute = useCallback(async (language, code) => {
    addLog('cmd', 'Executing ' + language + ' snippet...');
    setBottomTab('console');
    try {
      const res = await axios.post('/api/execute', { language, code });
      if (res.data.stdout) addLog('success', res.data.stdout);
      if (res.data.stderr) addLog('error',   res.data.stderr);
      if (!res.data.stdout && !res.data.stderr) addLog('info', '(no output)');
      addLog('info', 'Exit code: ' + res.data.exitCode);
    } catch (e) {
      addLog('error', e.response?.data?.error || e.message);
    }
  }, [addLog]);

  const handleSpectate = useCallback((targetUserId) => {
    if (spectating === targetUserId) {
      setSpectating(null);
      setSpectateFiles({});
      setSpectateActive(null);
      socketRef.current?.emit('spectate:stop', { roomCode, viewerId: userId });
    } else {
      setSpectating(targetUserId);
      socketRef.current?.emit('spectate:request', { roomCode, viewerId: userId, targetUserId });
    }
  }, [spectating, roomCode, userId]);

  const isViewer = userRole === 'viewer';

  return (
    <div className={styles.shell}>
      <Navbar
        roomCode={roomCode}
        projectName={session.room.name}
        users={users}
        userName={userName}
        userRole={userRole}
        projectState={projectState}
        onRun={handleRunProject}
        onLeave={onLeave}
        spectating={spectating}
        onFilesUploaded={(newFilePaths) => {
          addLog('success', `Uploaded ${newFilePaths.length} file(s) into room`);
        }}
      />

      <div className={styles.body}>
        {/* LEFT SIDEBAR */}
        <div className={styles.sidebar}>
          <FileExplorer
            files={files}
            activeFile={activeFile}
            onSelect={setActiveFile}
            onCreate={!isViewer ? handleCreateFile : null}
            onDelete={!isViewer ? handleDeleteFile : null}
            roleFilter={
              userRole === 'frontend' ? 'frontend' :
              userRole === 'backend'  ? 'backend'  : null
            }
          />

          <div className={styles.teamSection}>
            <div className={styles.teamHeader}>
              <span>Team</span>
              <span className={styles.onlinePill}>{users.filter(u => u.online).length} online</span>
            </div>
            {users.map(u => (
              <div key={u.id} className={styles.teamRow}>
                <div className={styles.teamAvatar} style={{ background: roleGradient(u.role) }}>
                  {u.name[0].toUpperCase()}
                </div>
                <div className={styles.teamMeta}>
                  <div className={styles.teamName}>{u.name}{u.id === userId ? ' ✦' : ''}</div>
                  <div className={styles.teamRole} style={{ color: roleColor(u.role) }}>{u.role}</div>
                </div>
                <div className={styles.statusRow}>
                  <div className={`${styles.dot} ${u.online ? styles.dotOn : styles.dotOff}`} />
                  {u.id !== userId && u.online && (
                    <button
                      className={`${styles.watchBtn} ${spectating === u.id ? styles.watchBtnOn : ''}`}
                      onClick={() => handleSpectate(u.id)}
                      title={spectating === u.id ? 'Stop watching' : 'Watch ' + u.name}
                    >
                      {spectating === u.id ? '◉' : '◎'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CENTRE WORKSPACE */}
        <div className={styles.centre}>
          <div className={styles.editorArea}>
            {spectating ? (
              <SpectatePanel
                files={spectateFiles}
                activeFile={spectateActive}
                targetUser={users.find(u => u.id === spectating)}
              />
            ) : (
              <RoleWorkspace
                userRole={userRole}
                files={files}
                activeFile={activeFile}
                onFileSelect={setActiveFile}
                onFileChange={isViewer ? null : handleFileChange}
                onCursorMove={handleCursorMove}
                onExecute={handleExecute}
                remoteCursors={remoteCursors}
                users={users}
                userId={userId}
                readOnly={isViewer}
              />
            )}
          </div>

          {/* BOTTOM PANEL */}
          <div className={styles.bottomPanel}>
            <div className={styles.bottomTabs}>
              <button
                className={`${styles.btab} ${bottomTab === 'console' ? styles.btabOn : ''}`}
                onClick={() => setBottomTab('console')}
              >
                &gt;_ Console
              </button>
              <button
                className={`${styles.btab} ${bottomTab === 'preview' ? styles.btabOn : ''}`}
                onClick={() => setBottomTab('preview')}
              >
                ⬡ Preview{projectState === 'ready' ? ' ●' : ''}
              </button>
            </div>
            <div className={styles.bottomContent}>
              {bottomTab === 'console'
                ? <ConsolePanel logs={consoleLogs} onClear={() => setConsoleLogs([])} />
                : <PreviewPanel state={projectState} url={previewUrl} error={projectError} />
              }
            </div>
          </div>
        </div>

        {/* RIGHT: CHAT + AI + DB */}
        <div className={styles.rightCol}>
          <div className={styles.rightTabBar}>
            <button className={`${styles.rightTab} ${rightTab === 'chat' ? styles.rightTabActive : ''}`} onClick={() => setRightTab('chat')}>💬 Chat</button>
            <button className={`${styles.rightTab} ${rightTab === 'ai'   ? styles.rightTabActive : ''}`} onClick={() => setRightTab('ai')}>✦ AI</button>
            <button className={`${styles.rightTab} ${rightTab === 'db'   ? styles.rightTabActive : ''}`} onClick={() => setRightTab('db')}>🗄 DB</button>
          </div>

          {rightTab === 'ai' && (
            <AiPanel
              currentFile={files[activeFile]?.content || ''}
              currentFilename={activeFile}
              consoleLogs={consoleLogs}
              onApplyCode={(code) => {
                if (activeFile && !isViewer) {
                  handleFileChange(activeFile, code);
                  addLog('success', 'AI code applied to ' + activeFile);
                }
              }}
            />
          )}

          {rightTab === 'db' && (
            <DatabasePanel roomCode={roomCode} />
          )}

          {rightTab === 'chat' && (
            <>
              <div className={styles.chatHeader}>
                <span>💬 Team Chat</span>
                {Object.keys(typingUsers).length > 0 && (
                  <span className={styles.typingTag}>typing…</span>
                )}
              </div>
              <ChatPanel
                messages={chatMessages}
                userId={userId}
                userName={userName}
                typingUsers={typingUsers}
                onSend={handleSendChat}
                onTyping={handleTyping}
              />
            </>
          )}
        </div>
      </div>

      {/* GEMINI VOICE DIRECTOR */}
      <VoiceDirector
        roomCode={roomCode}
        userId={userId}
        previewUrl={previewUrl}
        onEditApplied={({ summary }) => {
          addLog('success', `✦ Gemini Live: ${summary}`);
        }}
      />

      <StatusBar
        roomCode={roomCode}
        activeFile={spectating ? (spectateActive || '—') : activeFile}
        onlineCount={users.filter(u => u.online).length}
        projectState={projectState}
        userRole={userRole}
        watchingName={spectating ? users.find(u => u.id === spectating)?.name : null}
      />
    </div>
  );
}

// ── Role workspace renderer ──
function RoleWorkspace({ userRole, files, activeFile, onFileSelect, onFileChange,
  onCursorMove, onExecute, remoteCursors, users, userId, readOnly }) {

  const p = { files, activeFile, onFileSelect, onFileChange, onCursorMove,
               onExecute, remoteCursors, users, userId, readOnly };

  return (
    <div className={styles.roleWrapper}>
      <div className={styles.roleLabel} style={{ '--rc': roleMeta(userRole).color }}>
        <span className={styles.roleIcon}>{roleMeta(userRole).icon}</span>
        <span>{roleMeta(userRole).label}</span>
        {readOnly && <span className={styles.readonlyTag}>read-only</span>}
      </div>
      {userRole === 'fullstack' ? (
        <div className={styles.dualEditors}>
          <EditorPane {...p} title="Frontend" badge="fe" filterPrefix="frontend" />
          <div className={styles.splitLine} />
          <EditorPane {...p} title="Backend" badge="be" filterPrefix="backend" />
        </div>
      ) : userRole === 'frontend' ? (
        <EditorPane {...p} title="Frontend" badge="fe" filterPrefix="frontend" />
      ) : userRole === 'backend' ? (
        <EditorPane {...p} title="Backend"  badge="be" filterPrefix="backend" />
      ) : (
        <EditorPane {...p} title="All Files" badge="vi" filterPrefix="" />
      )}
    </div>
  );
}

function roleMeta(role) {
  return {
    frontend: { icon: '🎨', label: 'Frontend Workspace', color: 'var(--fe-color)' },
    backend:  { icon: '⚙️', label: 'Backend Workspace',  color: 'var(--be-color)' },
    fullstack:{ icon: '🔥', label: 'Full-Stack Workspace', color: 'var(--fs-color)' },
    viewer:   { icon: '👁',  label: 'Viewer — Read Only', color: 'var(--vi-color)' },
  }[role] || { icon: '👁', label: 'Workspace', color: 'var(--vi-color)' };
}

function roleColor(role) {
  return { frontend:'#61dafb', backend:'#10b981', fullstack:'#f59e0b', viewer:'#a78bfa' }[role] || '#94a3b8';
}

function roleGradient(role) {
  return {
    frontend: 'linear-gradient(135deg,#0ea5e9,#6366f1)',
    backend:  'linear-gradient(135deg,#10b981,#059669)',
    fullstack:'linear-gradient(135deg,#f59e0b,#ef4444)',
    viewer:   'linear-gradient(135deg,#64748b,#334155)',
  }[role] || 'linear-gradient(135deg,#64748b,#334155)';
}
