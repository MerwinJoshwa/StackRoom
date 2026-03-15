import React, { useState } from 'react';
import styles from './FileExplorer.module.css';

const FILE_ICONS = {
  jsx: { icon: '⬡', color: '#61dafb' },
  js:  { icon: '◆', color: '#f7df1e' },
  ts:  { icon: '◆', color: '#3178c6' },
  tsx: { icon: '⬡', color: '#61dafb' },
  css: { icon: '◉', color: '#ec4899' },
  html:{ icon: '◈', color: '#f97316' },
  json:{ icon: '{}', color: '#a78bfa' },
  md:  { icon: '📄', color: '#94a3b8' },
  py:  { icon: '🐍', color: '#3b82f6' },
  java:{ icon: '☕', color: '#f97316' },
  cpp: { icon: '⚙', color: '#6366f1' },
  sh:  { icon: '$', color: '#10b981' },
};

function getIcon(filename) {
  const ext = filename.split('.').pop();
  return FILE_ICONS[ext] || { icon: '📄', color: '#64748b' };
}

const LANG_MAP = {
  jsx:'jsx', js:'javascript', ts:'typescript', tsx:'tsx',
  css:'css', html:'html', json:'json', py:'python',
  java:'java', cpp:'cpp', md:'markdown', sh:'sh',
};

export default function FileExplorer({ files, activeFile, onSelect, onCreate, onDelete, roleFilter }) {
  const [newFile, setNewFile] = useState('');
  const [showInput, setShowInput] = useState(false);

  const grouped = { frontend: [], backend: [], root: [] };
  Object.keys(files).forEach(p => {
    // If a roleFilter is set, only show files matching that prefix
    if (roleFilter && !p.startsWith(roleFilter + '/')) return;
    if (p.startsWith('frontend/')) grouped.frontend.push(p);
    else if (p.startsWith('backend/')) grouped.backend.push(p);
    else grouped.root.push(p);
  });

  const submitNew = () => {
    if (!newFile.trim()) return;
    const clean = newFile.trim().replace(/\\/g, '/');
    const ext = clean.split('.').pop();
    const lang = LANG_MAP[ext] || 'javascript';
    onCreate(clean, lang);
    setNewFile('');
    setShowInput(false);
    onSelect(clean);
  };

  const renderFile = (path) => {
    const filename = path.split('/').pop();
    const { icon, color } = getIcon(filename);
    return (
      <div
        key={path}
        className={`${styles.file} ${activeFile === path ? styles.fileActive : ''}`}
        onClick={() => onSelect(path)}
        title={path}
      >
        <span style={{ color, fontSize: '11px' }}>{icon}</span>
        <span className={styles.fileName}>{filename}</span>
        <button
          className={styles.delBtn}
          onClick={e => { e.stopPropagation(); onDelete(path); }}
          title="Delete"
          style={{ display: onDelete ? undefined : 'none' }}
        >×</button>
      </div>
    );
  };

  return (
    <div className={styles.explorer}>
      <div className={styles.header}>
        Explorer
        {onCreate && <button className={styles.addBtn} onClick={() => setShowInput(v => !v)} title="New file">+</button>}
      </div>

      {showInput && (
        <div className={styles.newFileRow}>
          <input
            className={styles.newFileInput}
            placeholder="frontend/Component.jsx"
            value={newFile}
            onChange={e => setNewFile(e.target.value)}
            onKeyDown={e => { if(e.key==='Enter') submitNew(); if(e.key==='Escape') setShowInput(false); }}
            autoFocus
          />
          <button className={styles.newFileBtn} onClick={submitNew}>✓</button>
        </div>
      )}

      <div className={styles.tree}>
        {grouped.frontend.length > 0 && (
          <div className={styles.section}>
            <div className={styles.folder}>▸ frontend</div>
            {grouped.frontend.map(renderFile)}
          </div>
        )}
        {grouped.backend.length > 0 && (
          <div className={styles.section}>
            <div className={styles.folder}>▸ backend</div>
            {grouped.backend.map(renderFile)}
          </div>
        )}
        {grouped.root.map(renderFile)}
      </div>
    </div>
  );
}
