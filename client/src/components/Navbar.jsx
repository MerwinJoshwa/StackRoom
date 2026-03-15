import React, { useState, useRef } from 'react';
import axios from 'axios';
import styles from './Navbar.module.css';

const ROLE_COLORS = {
  frontend: '#61dafb', backend: '#10b981', fullstack: '#f59e0b', viewer: '#a78bfa',
};

export default function Navbar({ roomCode, projectName, users, userName, userRole, projectState, onRun, onLeave, spectating, onFilesUploaded }) {
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const copy = () => {
    navigator.clipboard.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Download all room files as zip ───
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = `/api/rooms/${roomCode}/download`;
    link.download = `${projectName}.zip`;
    link.click();
  };

  // ─── Upload local files into room ───
  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFilesSelected = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (!selectedFiles.length) return;

    setUploading(true);
    const filesObj = {};

    await Promise.all(selectedFiles.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          // Preserve folder structure if dragged from a folder
          const filePath = file.webkitRelativePath || file.name;
          filesObj[filePath] = ev.target.result;
          resolve();
        };
        reader.readAsText(file);
      });
    }));

    try {
      const res = await axios.post(`/api/rooms/${roomCode}/upload`, { files: filesObj });
      if (onFilesUploaded) onFilesUploaded(res.data.files);
    } catch (err) {
      console.error('Upload failed:', err);
    }

    setUploading(false);
    // Reset input so same files can be re-uploaded
    e.target.value = '';
  };

  const onlineUsers = users.filter(u => u.online);
  const roleColor = ROLE_COLORS[userRole] || '#94a3b8';

  return (
    <nav className={styles.navbar}>
      <span className={styles.logo}>{'{}'} StackRoom</span>
      <div className={styles.sep} />

      <button className={styles.roomBadge} onClick={copy} title="Click to copy room code">
        <span className={styles.dot} />
        <span>{copied ? 'Copied!' : roomCode}</span>
      </button>

      <div className={styles.sep} />
      <span className={styles.projectName}>{projectName}</span>

      {/* Role tag */}
      <div className={styles.rolePill} style={{ '--rc': roleColor }}>
        {userRole === 'frontend' ? '🎨' : userRole === 'backend' ? '⚙️' : userRole === 'fullstack' ? '🔥' : '👁'} {userRole}
      </div>

      {spectating && <div className={styles.spectateTag}>◉ Watching</div>}

      <div className={styles.avatarStack}>
        {onlineUsers.slice(0, 5).map(u => (
          <div
            key={u.id}
            className={styles.avatar}
            style={{ background: avatarGradient(u.role) }}
            title={u.name + ' · ' + u.role}
          >
            {u.name[0].toUpperCase()}
          </div>
        ))}
        {onlineUsers.length > 5 && <div className={styles.avatarMore}>+{onlineUsers.length - 5}</div>}
      </div>

      {/* Upload button */}
      <button
        className={styles.iconBtn}
        onClick={handleUploadClick}
        title="Upload local files into room"
        disabled={uploading}
      >
        {uploading ? '⏳' : '⬆ Upload'}
      </button>

      {/* Hidden file input — allows multiple files + folders */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
        accept=".js,.jsx,.ts,.tsx,.py,.java,.cpp,.c,.css,.html,.json,.md,.sh,.txt"
      />

      {/* Download button */}
      <button
        className={styles.iconBtn}
        onClick={handleDownload}
        title="Download all room files as zip"
      >
        ⬇ Download
      </button>

      <button
        className={`${styles.runBtn} ${projectState === 'running' ? styles.runBtnRunning : ''} ${projectState === 'ready' ? styles.runBtnReady : ''}`}
        onClick={onRun}
        disabled={projectState === 'running'}
      >
        {projectState === 'running' ? '⏳ Building…' : projectState === 'ready' ? '■ Stop' : '▶ Run Project'}
      </button>

      <button className={styles.leaveBtn} onClick={onLeave} title="Leave room">✕ Leave</button>
    </nav>
  );
}

function avatarGradient(role) {
  return {
    frontend:'linear-gradient(135deg,#0ea5e9,#6366f1)',
    backend:'linear-gradient(135deg,#10b981,#059669)',
    fullstack:'linear-gradient(135deg,#f59e0b,#ef4444)',
    viewer:'linear-gradient(135deg,#64748b,#334155)',
  }[role] || 'linear-gradient(135deg,#64748b,#334155)';
}
