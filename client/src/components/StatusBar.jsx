import React from 'react';
import styles from './StatusBar.module.css';

export default function StatusBar({ roomCode, activeFile, onlineCount, projectState, userRole, watchingName }) {
  const lang = activeFile ? activeFile.split('.').pop().toUpperCase() : '';
  return (
    <div className={styles.bar}>
      <span className={styles.item}>⬡ StackRoom</span>
      {userRole && <span className={styles.item} style={{ color: roleColor(userRole) }}>{userRole}</span>}
      {watchingName && <span className={styles.item} style={{ color:'var(--warn)' }}>◉ watching {watchingName}</span>}
      <span className={styles.item}>{activeFile || '—'}</span>
      {lang && <span className={styles.item}>{lang}</span>}
      <span className={styles.spacer} />
      <span className={styles.item}>
        <span className={styles.dot} style={{ background: projectState === 'ready' ? '#10b981' : '#f59e0b' }} />
        {projectState === 'idle' ? 'Idle' : projectState === 'running' ? 'Building' : 'Running'}
      </span>
      <span className={styles.item}>● {onlineCount} online</span>
      <span className={styles.item}>Room: <strong>{roomCode}</strong></span>
    </div>
  );
}
function roleColor(role) {
  return { frontend:'#61dafb', backend:'#10b981', fullstack:'#f59e0b', viewer:'#a78bfa' }[role] || '#94a3b8';
}
