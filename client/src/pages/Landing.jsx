import React, { useState } from 'react';
import axios from 'axios';
import styles from './Landing.module.css';

const ROLES = [
  { value: 'frontend', label: '🎨 Frontend Developer' },
  { value: 'backend',  label: '⚙️ Backend Developer' },
  { value: 'fullstack',label: '🔥 Full-Stack Developer' },
  { value: 'viewer',   label: '👁 Viewer' },
];

export default function Landing({ onJoin }) {
  const [modal, setModal] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [role, setRole] = useState('frontend');
  const [roomName, setRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const open = (type) => { setModal(type); setError(''); };
  const close = () => { setModal(null); setError(''); };

  const handleCreate = async () => {
    if (!name.trim()) return setError('Enter your name');
    setLoading(true);
    try {
      const res = await axios.post('/api/rooms', { name, role, roomName: roomName || undefined });
      onJoin({ roomCode: res.data.roomCode, userId: res.data.userId, room: res.data.room, userName: name, userRole: role });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create room');
    }
    setLoading(false);
  };

  const handleJoin = async () => {
    if (!name.trim()) return setError('Enter your name');
    if (!joinCode.trim()) return setError('Enter room code');
    setLoading(true);
    try {
      const res = await axios.post(`/api/rooms/${joinCode.toUpperCase()}/join`, { name, role });
      onJoin({ roomCode: joinCode.toUpperCase(), userId: res.data.userId, room: res.data.room, userName: name, userRole: role });
    } catch (e) {
      setError(e.response?.data?.error || 'Room not found');
    }
    setLoading(false);
  };

  return (
    <div className={styles.landing}>
      <div className={styles.gridBg} />
      <div className={styles.orb1} /><div className={styles.orb2} /><div className={styles.orb3} />

      <div className={styles.content}>
        <div className={styles.logoMark}>{'{}'} StackRoom</div>
        <h1 className={styles.title}>Build Together.<br /><span>Ship Faster.</span></h1>
        <p className={styles.sub}>
          Real-time collaborative IDE. Code, chat, compile,<br />and preview — all in one shared room.
        </p>
        <div className={styles.ctaGroup}>
          <button className={styles.btnPrimary} onClick={() => open('create')}>+ Create Room</button>
          <button className={styles.btnSecondary} onClick={() => open('join')}>Join Room</button>
        </div>
        <div className={styles.pills}>
          {['Monaco Editor','WebSockets','Multi-Language','Live Preview','Team Chat'].map(p=>(
            <span key={p} className={styles.pill}>{p}</span>
          ))}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && close()}>
          <div className={styles.modal}>
            <button className={styles.modalClose} onClick={close}>✕</button>
            <div className={styles.modalTitle}>{modal === 'create' ? 'Create a Room' : 'Join a Room'}</div>
            <div className={styles.modalSub}>// {modal === 'create' ? 'Start a new collaborative session' : 'Enter an existing session'}</div>

            <label className={styles.label}>Your Name</label>
            <input className={styles.input} placeholder="e.g. Alice" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key==='Enter' && (modal==='create'?handleCreate():handleJoin())} />

            {modal === 'create' && (
              <>
                <label className={styles.label}>Project Name (optional)</label>
                <input className={styles.input} placeholder="e.g. my-app" value={roomName} onChange={e => setRoomName(e.target.value)} />
              </>
            )}

            {modal === 'join' && (
              <>
                <label className={styles.label}>Room Code</label>
                <input className={styles.input} placeholder="e.g. X9A4B2" value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  style={{ letterSpacing: '4px', fontSize: '18px', textTransform: 'uppercase' }} />
              </>
            )}

            <label className={styles.label}>Your Role</label>
            <select className={styles.input} value={role} onChange={e => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>

            {error && <div className={styles.error}>{error}</div>}

            <button
              className={styles.btnPrimary}
              style={{ width: '100%', marginTop: '16px', padding: '12px' }}
              onClick={modal === 'create' ? handleCreate : handleJoin}
              disabled={loading}
            >
              {loading ? 'Connecting...' : modal === 'create' ? 'Create & Enter →' : 'Join Room →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
