import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './VoiceDirector.module.css';

/**
 * VoiceDirector — Gemini voice interface for StackRoom
 *
 * Uses Web Speech API (SpeechRecognition) to transcribe mic audio in-browser,
 * then sends the transcript as text to our server → Gemini REST API.
 *
 * This avoids all raw PCM/audio encoding issues — the browser handles transcription.
 */

export default function VoiceDirector({ roomCode, userId, previewUrl, onEditApplied }) {
  const [state, setState] = useState('idle'); // idle | connecting | ready | listening | processing
  const [lastEdit, setLastEdit] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [transcript, setTranscript] = useState('');

  const wsRef = useRef(null);
  const recognitionRef = useRef(null);

  // ── Connect to our server WebSocket ──
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setState('connecting');
    setError('');
    setStatusMsg('Connecting...');

    const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gemini-live?room=${roomCode}&userId=${userId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatusMsg('Waiting for server...');

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'ready') {
          setState('ready');
          setStatusMsg(msg.message || '🎙 Ready — tap mic to speak');
        } else if (msg.type === 'status') {
          setStatusMsg(msg.message);
        } else if (msg.type === 'error') {
          setError(msg.message);
          setState('ready'); // stay connected, just show error
        } else if (msg.type === 'edit-complete') {
          setState('ready');
          setLastEdit({ summary: msg.summary, files: msg.files });
          setStatusMsg('✓ ' + msg.summary);
          setTranscript('');
          if (onEditApplied) onEditApplied(msg);
        } else if (msg.type === 'message') {
          setState('ready');
          setStatusMsg(msg.text);
        }
      } catch (_) {}
    };

    ws.onerror = () => { setError('Connection failed'); setState('idle'); };
    ws.onclose = () => {
      stopRecognition();
      if (state !== 'idle') setState('idle');
    };
  }, [roomCode, userId]);

  const disconnect = useCallback(() => {
    stopRecognition();
    wsRef.current?.close();
    wsRef.current = null;
    setState('idle');
    setStatusMsg('');
    setTranscript('');
  }, []);

  // ── Web Speech API ──
  const startRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser. Use Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setState('listening');
      setStatusMsg('🎙 Listening — speak your instruction…');
      setTranscript('');
      setError('');
    };

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      setTranscript(final || interim);
    };

    recognition.onend = () => {
      // Speech ended — send whatever we heard to Gemini
      const heard = recognitionRef.current?._finalTranscript || transcript;
      recognitionRef.current = null;

      if (heard?.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
        setState('processing');
        setStatusMsg('⚙ Gemini is thinking...');
        wsRef.current.send(JSON.stringify({ type: 'text', text: heard.trim() }));
      } else {
        setState('ready');
        setStatusMsg('🎙 Ready — tap mic to speak');
        setTranscript('');
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        setStatusMsg('No speech detected — try again');
      } else if (e.error === 'not-allowed') {
        setError('Mic permission denied');
      } else {
        setError('Speech error: ' + e.error);
      }
      setState('ready');
      recognitionRef.current = null;
    };

    // Store final transcript on the recognition object for onend access
    let finalText = '';
    const origOnResult = recognition.onresult;
    recognition.onresult = (e) => {
      origOnResult(e);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      recognition._finalTranscript = finalText;
    };

    recognition.start();
  }, [transcript]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  // ── Mic button handler ──
  const handleMicBtn = useCallback(() => {
    if (state === 'idle') {
      setExpanded(true);
      connect();
    } else if (state === 'ready') {
      startRecognition();
    } else if (state === 'listening') {
      stopRecognition(); // triggers onend → sends to Gemini
    }
  }, [state, connect, startRecognition, stopRecognition]);

  // ── Text input fallback ──
  const handleTextSend = useCallback(() => {
    const text = textInput.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'text', text }));
    setState('processing');
    setStatusMsg('⚙ Gemini is thinking...');
    setTextInput('');
  }, [textInput]);

  useEffect(() => () => disconnect(), []);

  const micLabel = {
    idle: '✦ Start Voice',
    connecting: '⏳ Connecting...',
    ready: '🎙 Tap to Speak',
    listening: '⏹ Stop',
    processing: '⚙ Processing...',
  }[state];

  const micActive = state === 'listening';
  const micDisabled = state === 'connecting' || state === 'processing';

  return (
    <div className={`${styles.container} ${expanded ? styles.expanded : ''}`}>
      {/* Collapsed pill */}
      {!expanded && (
        <button
          className={`${styles.pill} ${micActive ? styles.pillActive : ''} ${state !== 'idle' ? styles.pillConnected : ''}`}
          onClick={() => { setExpanded(true); if (state === 'idle') connect(); }}
          title="Gemini Voice Director"
        >
          <span className={`${styles.pillDot} ${micActive ? styles.pillDotPulse : ''}`} />
          {state === 'idle' ? '✦ Voice' : state === 'listening' ? '🎙 Live' : '✦ Gemini'}
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>
              <span className={`${styles.geminiBadge} ${micActive ? styles.geminiBadgeActive : ''}`}>✦</span>
              Gemini Live
            </div>
            <button className={styles.collapseBtn} onClick={() => setExpanded(false)}>✕</button>
          </div>

          {/* Status */}
          <div className={styles.status}>
            {error
              ? <span className={styles.statusErr}>⚠ {error}</span>
              : <span className={styles.statusText}>{statusMsg || 'Tap the mic to start'}</span>
            }
          </div>

          {/* Live transcript */}
          {transcript && (
            <div className={styles.transcriptBox}>
              <span className={styles.transcriptLabel}>Heard:</span> {transcript}
            </div>
          )}

          {/* Last edit */}
          {lastEdit && (
            <div className={styles.lastEdit}>
              <div className={styles.lastEditLabel}>Last edit</div>
              <div className={styles.lastEditSummary}>{lastEdit.summary}</div>
              <div className={styles.lastEditFiles}>
                {lastEdit.files.map(f => (
                  <span key={f} className={styles.fileTag}>{f.split('/').pop()}</span>
                ))}
              </div>
            </div>
          )}

          {/* Mic button */}
          <button
            className={`${styles.micBtn} ${micActive ? styles.micBtnActive : ''} ${micDisabled ? styles.micBtnDisabled : ''}`}
            onClick={handleMicBtn}
            disabled={micDisabled}
          >
            {micActive ? (
              <>
                <span className={styles.micRing} />
                <span className={styles.micRing2} />
                <span className={styles.micIcon}>⏹</span>
              </>
            ) : (
              <span className={styles.micIcon}>🎙</span>
            )}
          </button>
          <div className={styles.micLabel}>{micLabel}</div>

          {/* Text input fallback */}
          {(state === 'ready' || state === 'listening') && (
            <div className={styles.textRow}>
              <input
                className={styles.textInput}
                placeholder="Or type an instruction…"
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleTextSend()}
              />
              <button className={styles.textSend} onClick={handleTextSend} disabled={!textInput.trim()}>↑</button>
            </div>
          )}

          {state !== 'idle' && (
            <button className={styles.disconnectBtn} onClick={disconnect}>Disconnect</button>
          )}

          <div className={styles.hint}>
            Gemini sees your codebase and running preview.<br />
            Speak naturally — edits apply live to all teammates.
          </div>
        </div>
      )}
    </div>
  );
}
