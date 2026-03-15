import React, { useEffect, useRef } from 'react';
import styles from './ConsolePanel.module.css';

export function ConsolePanel({ logs, onClear }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className={styles.console}>
      <div className={styles.header}>
        Console / Output
        <button className={styles.clearBtn} onClick={onClear} title="Clear">⊘ Clear</button>
      </div>
      <div className={styles.body}>
        {logs.map((log, i) => (
          <div key={log.id || i} className={`${styles.line} ${styles[log.type] || ''}`}>
            {log.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ConsolePanel;
