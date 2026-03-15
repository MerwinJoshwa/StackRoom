import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './AiPanel.module.css';

const MODES = [
  { id: 'ask',      label: '💬 Ask',      placeholder: 'Ask anything about your code...' },
  { id: 'generate', label: '✨ Generate', placeholder: 'Describe what you want to build...' },
  { id: 'fix',      label: '🔧 Fix',      placeholder: 'Describe the issue or paste the error...' },
  { id: 'explain',  label: '📖 Explain',  placeholder: 'Click Explain to understand this file...' },
];

// Extract code blocks from markdown response
function parseResponse(text) {
  const blocks = [];
  const codeRegex = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > last) {
      blocks.push({ type: 'text', content: text.slice(last, match.index) });
    }
    blocks.push({ type: 'code', lang: match[1], content: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) blocks.push({ type: 'text', content: text.slice(last) });
  return blocks;
}

export default function AiPanel({ currentFile, currentFilename, onApplyCode, consoleLogs }) {
  const [mode, setMode] = useState('ask');
  const [instruction, setInstruction] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);
  const responseRef = useRef(null);
  const abortRef = useRef(null);

  // Auto scroll response
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [response]);

  const currentMode = MODES.find(m => m.id === mode);

  const handleSubmit = useCallback(async () => {
    if (loading) {
      // Cancel ongoing request
      if (abortRef.current) abortRef.current.abort();
      setLoading(false);
      return;
    }

    const prompt = mode === 'explain' ? 'explain' : instruction.trim();
    if (!prompt && mode !== 'explain') return;

    setLoading(true);
    setResponse('');
    setError('');

    const controller = new AbortController();
    abortRef.current = controller;

    // Get last error from console for fix mode
    const lastError = consoleLogs
      ? consoleLogs.filter(l => l.type === 'error').slice(-3).map(l => l.text).join('\n')
      : '';

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          mode,
          code: currentFile || '',
          filename: currentFilename || 'file',
          instruction: prompt,
          errorLog: mode === 'fix' ? (instruction.trim() || lastError) : '',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(err.error || 'AI request failed');
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { setLoading(false); return; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) { setError(parsed.error); setLoading(false); return; }
            if (parsed.text) setResponse(prev => prev + parsed.text);
          } catch (e) {}
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    }
    setLoading(false);
  }, [mode, instruction, currentFile, currentFilename, consoleLogs, loading]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const blocks = parseResponse(response);
  const hasCode = blocks.some(b => b.type === 'code');

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.headerTitle}>✦ AI Assistant</span>
        <span className={styles.headerSub}>{currentFilename || 'no file'}</span>
      </div>

      {/* Mode tabs */}
      <div className={styles.modes}>
        {MODES.map(m => (
          <button
            key={m.id}
            className={`${styles.modeBtn} ${mode === m.id ? styles.modeBtnActive : ''}`}
            onClick={() => { setMode(m.id); setResponse(''); setError(''); }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        {mode !== 'explain' && (
          <textarea
            className={styles.textarea}
            placeholder={currentMode.placeholder}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
          />
        )}
        {mode === 'explain' && (
          <div className={styles.explainHint}>
            Will explain: <strong>{currentFilename || 'current file'}</strong>
          </div>
        )}
        {mode === 'fix' && (
          <div className={styles.fixHint}>
            💡 Leave blank to auto-use last console error
          </div>
        )}
        <div className={styles.inputFooter}>
          <span className={styles.hint}>Ctrl+Enter to send</span>
          <button
            className={`${styles.sendBtn} ${loading ? styles.sendBtnStop : ''}`}
            onClick={handleSubmit}
            disabled={!currentFile && mode !== 'ask'}
          >
            {loading ? '■ Stop' : '▶ Send'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.errorBox}>
          <span>✗ {error}</span>
          {error.includes('ANTHROPIC_API_KEY') && (
            <div className={styles.keyHelp}>
              Set your key: <code>ANTHROPIC_API_KEY=sk-ant-... node index.js</code>
            </div>
          )}
        </div>
      )}

      {/* Response */}
      {(response || loading) && (
        <div className={styles.response} ref={responseRef}>
          {loading && !response && (
            <div className={styles.thinking}>
              <span className={styles.thinkDot} />
              <span className={styles.thinkDot} />
              <span className={styles.thinkDot} />
            </div>
          )}

          {blocks.map((block, i) => {
            if (block.type === 'text') {
              return (
                <p key={i} className={styles.textBlock}>
                  {block.content}
                </p>
              );
            }
            return (
              <div key={i} className={styles.codeBlock}>
                <div className={styles.codeHeader}>
                  <span className={styles.codeLang}>{block.lang || 'code'}</span>
                  <div className={styles.codeActions}>
                    <button
                      className={styles.codeBtn}
                      onClick={() => handleCopy(block.content, i)}
                    >
                      {copied === i ? '✓ Copied' : '⎘ Copy'}
                    </button>
                    {onApplyCode && (
                      <button
                        className={`${styles.codeBtn} ${styles.applyBtn}`}
                        onClick={() => onApplyCode(block.content)}
                        title="Replace current file with this code"
                      >
                        ⬇ Apply to file
                      </button>
                    )}
                  </div>
                </div>
                <pre className={styles.codePre}><code>{block.content}</code></pre>
              </div>
            );
          })}

          {/* Apply all code button if multiple blocks */}
          {hasCode && blocks.filter(b => b.type === 'code').length === 1 && !loading && (
            <div className={styles.applyAll}>
              <button
                className={styles.applyAllBtn}
                onClick={() => {
                  const codeBlock = blocks.find(b => b.type === 'code');
                  if (codeBlock && onApplyCode) onApplyCode(codeBlock.content);
                }}
              >
                ⬇ Apply code to {currentFilename}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!response && !loading && !error && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>✦</div>
          <div className={styles.emptyText}>AI coding assistant</div>
          <div className={styles.emptyHints}>
            <div>✨ <strong>Generate</strong> — write new code</div>
            <div>🔧 <strong>Fix</strong> — debug errors</div>
            <div>💬 <strong>Ask</strong> — any question</div>
            <div>📖 <strong>Explain</strong> — understand code</div>
          </div>
        </div>
      )}
    </div>
  );
}
