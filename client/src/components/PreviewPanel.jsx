import React, { useRef, useState } from 'react';
import styles from './PreviewPanel.module.css';

export default function PreviewPanel({ state, url, error }) {
  const iframeRef = useRef(null);
  const [iframeKey, setIframeKey] = useState(0);

  const reload = () => setIframeKey(k => k + 1);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        Preview
        {state === 'ready' && (
          <div style={{ display:'flex', gap:'6px' }}>
            <button className={styles.hBtn} onClick={reload} title="Reload">↻</button>
            <a className={styles.hBtn} href={url} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
          </div>
        )}
      </div>

      <div className={styles.bar}>
        <div className={styles.dots}>
          <span style={{ background:'#ef4444' }} />
          <span style={{ background:'#f59e0b' }} />
          <span style={{ background:'#10b981' }} />
        </div>
        <div className={styles.url}>{url || 'about:blank'}</div>
      </div>

      <div className={styles.content}>
        {state === 'idle' && (
          <div className={styles.idle}>
            <div className={styles.idleIcon}>⬡</div>
            <div className={styles.idleText}>Click <strong>▶ Run Project</strong> to start</div>
            <div className={styles.idleSub}>Your backend will start and frontend will be served live</div>
          </div>
        )}

        {state === 'running' && (
          <div className={styles.building}>
            <div className={styles.spinner} />
            <div className={styles.buildText}>Building & starting project…</div>
            <div className={styles.buildSub}>Installing deps and starting your server</div>
          </div>
        )}

        {state === 'error' && (
          <div className={styles.errorState}>
            <div className={styles.errorIcon}>✗</div>
            <div className={styles.errorTitle}>Build Failed</div>
            <div className={styles.errorMsg}>{error}</div>
          </div>
        )}

        {state === 'ready' && url && (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={url}
            className={styles.iframe}
            title="Project Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
          />
        )}
      </div>
    </div>
  );
}
