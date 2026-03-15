import React, { useState, useCallback, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import styles from './EditorPane.module.css';

const LANG_MAP = {
  jsx:'javascript', tsx:'typescript', js:'javascript', ts:'typescript',
  css:'css', html:'html', json:'json', py:'python',
  java:'java', cpp:'cpp', md:'markdown', sh:'shell',
};
function getLang(filename) {
  const ext = filename?.split('.').pop() || 'js';
  return LANG_MAP[ext] || 'javascript';
}
const TAB_COLORS = {
  frontend:'#61dafb', backend:'#10b981', css:'#ec4899', html:'#f97316', json:'#a78bfa',
};
function getTabColor(path) {
  if (path.startsWith('frontend')) return TAB_COLORS.frontend;
  if (path.startsWith('backend')) return TAB_COLORS.backend;
  const ext = path.split('.').pop();
  return TAB_COLORS[ext] || '#94a3b8';
}
const EXEC_LANGS = { js:'javascript', py:'python', java:'java', cpp:'cpp', sh:'bash' };

export default function EditorPane({
  title, badge, files, activeFile, onFileSelect,
  onFileChange, onCursorMove, onExecute,
  filterPrefix, remoteCursors, users, userId, readOnly
}) {
  const [localActive, setLocalActive] = useState(null);
  const editorRef = useRef(null);
  const isUserTypingRef = useRef(false);

  // filterPrefix='' means show all files (viewer)
  const paneFiles = filterPrefix === ''
    ? Object.keys(files)
    : Object.keys(files).filter(p => p.startsWith(filterPrefix + '/'));

  const displayed = localActive && paneFiles.includes(localActive)
    ? localActive
    : paneFiles.includes(activeFile)
      ? activeFile
      : paneFiles[0];

  const handleTabClick = (path) => {
    setLocalActive(path);
    onFileSelect(path);
  };

  const currentFile = files[displayed];
  const currentLang = displayed ? getLang(displayed) : 'javascript';

  const handleChange = useCallback((value) => {
    isUserTypingRef.current = true;
    if (displayed && onFileChange) onFileChange(displayed, value || '');
    // Reset flag after a short debounce
    clearTimeout(handleChange._t);
    handleChange._t = setTimeout(() => { isUserTypingRef.current = false; }, 500);
  }, [displayed, onFileChange]);

  // When displayed file content changes externally (e.g. Gemini edit), sync Monaco model
  useEffect(() => {
    if (!editorRef.current || !displayed) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const incoming = files[displayed]?.content ?? '';
    if (model.getValue() !== incoming) {
      // Push as an edit so undo history is preserved, but only if not the user typing
      if (!isUserTypingRef.current) {
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: incoming }], () => null);
      }
    }
  }, [files, displayed]);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    // Force Monaco to recalculate layout after container dimensions settle
    setTimeout(() => editor.layout(), 0);
    setTimeout(() => editor.layout(), 100);
    setTimeout(() => editor.layout(), 400);
    if (!readOnly) {
      editor.onDidChangeCursorPosition((e) => {
        if (displayed) onCursorMove(displayed, e.position.lineNumber, e.position.column);
      });
    }
    monaco.editor.defineTheme('stackroom', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token:'comment', foreground:'546e7a', fontStyle:'italic' },
        { token:'keyword', foreground:'c792ea' },
        { token:'string',  foreground:'c3e88d' },
        { token:'number',  foreground:'f78c6c' },
        { token:'type',    foreground:'ffcb6b' },
        { token:'function',foreground:'82aaff' },
        { token:'variable',foreground:'eeffff' },
        { token:'tag',     foreground:'f07178' },
        { token:'attribute.name',  foreground:'ffcb6b' },
        { token:'attribute.value', foreground:'c3e88d' },
      ],
      colors: {
        'editor.background':'#13161d','editor.foreground':'#eeffff',
        'editor.lineHighlightBackground':'#1a1e2b',
        'editorLineNumber.foreground':'#2a3045','editorLineNumber.activeForeground':'#546e7a',
        'editor.selectionBackground':'#2a3045','editorCursor.foreground':'#00e5ff',
        'editor.findMatchBackground':'#2a3045','editorGutter.background':'#13161d',
        'scrollbar.shadow':'#00000000','scrollbarSlider.background':'#1e233066',
        'scrollbarSlider.hoverBackground':'#2a304566',
      }
    });
    monaco.editor.setTheme('stackroom');
  };

  const activeCursors = Object.entries(remoteCursors || {})
    .filter(([uid, c]) => uid !== userId && c.filePath === displayed)
    .map(([uid, c]) => {
      const user = (users || []).find(u => u.id === uid);
      return { ...c, name: user?.name || 'Dev', uid };
    });

  const ext = displayed?.split('.').pop();
  const canExec = ext && EXEC_LANGS[ext] && !readOnly;

  return (
    <div className={styles.pane}>
      <div className={styles.tabs}>
        {paneFiles.map(path => {
          const fname = path.split('/').pop();
          return (
            <div
              key={path}
              className={`${styles.tab} ${displayed === path ? styles.tabActive : ''}`}
              onClick={() => handleTabClick(path)}
              title={path}
            >
              <span className={styles.tabDot} style={{ background: getTabColor(path) }} />
              {fname}
            </div>
          );
        })}
        <div className={`${styles.roleBadge} ${badge === 'fe' ? styles.roleFe : badge === 'be' ? styles.roleBe : styles.roleVi}`}>
          {title}
        </div>
      </div>

      <div className={styles.editorWrap}>
        {activeCursors.map(c => (
          <div key={c.uid} className={styles.cursorLabel} title={c.name + ': line ' + c.line}>
            {c.name} L{c.line}
          </div>
        ))}

        {currentFile ? (
          <Editor
            height="100%"
            language={currentLang}
            value={currentFile.content}
            onChange={handleChange}
            onMount={handleEditorMount}
            theme="stackroom"
            options={{
              readOnly: !!readOnly,
              domReadOnly: !!readOnly,
              fontSize: 12.5, lineHeight: 20,
              fontFamily: "'JetBrains Mono', monospace",
              fontLigatures: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              renderLineHighlight: 'line',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              bracketPairColorization: { enabled: true },
              formatOnPaste: true,
              tabSize: 2,
              padding: { top: 12 },
            }}
          />
        ) : (
          <div className={styles.emptyPane}>
            <span>No {filterPrefix || ''} files</span>
            <small>{readOnly ? 'Read-only viewer' : 'Use the Explorer to create files'}</small>
          </div>
        )}

        {canExec && (
          <button
            className={styles.execBtn}
            title={'Run ' + ext + ' snippet'}
            onClick={() => onExecute(EXEC_LANGS[ext], currentFile?.content || '')}
          >
            ▶ Run
          </button>
        )}
      </div>
    </div>
  );
}
