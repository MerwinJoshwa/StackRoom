import React, { useState, useEffect, useRef } from 'react';
import styles from './ChatPanel.module.css';

export default function ChatPanel({ messages, userId, userName, typingUsers, onSend, onTyping }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
    onTyping(false);
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    onTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 1500);
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  const typingNames = Object.values(typingUsers).filter(Boolean);

  return (
    <div className={styles.panel}>
      <div className={styles.messages}>
        {messages.map((msg, i) => {
          if (msg.type === 'system') {
            return (
              <div key={msg.id || i} className={styles.sysMsg}>
                {msg.text}
              </div>
            );
          }
          const isMe = msg.userId === userId;
          return (
            <div key={msg.id || i} className={`${styles.msg} ${isMe ? styles.msgMe : ''}`}>
              <div className={styles.msgHeader}>
                <span
                  className={styles.author}
                  style={{ color: isMe ? '#f59e0b' : roleColor(msg.role) }}
                >
                  {isMe ? 'You' : msg.author}
                </span>
                <span className={styles.time}>{formatTime(msg.at)}</span>
              </div>
              <div
                className={styles.bubble}
                style={{ borderLeftColor: isMe ? '#f59e0b44' : roleColor(msg.role) + '44' }}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <div className={styles.typing}>
            {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing
            <span className={styles.dots}><span/><span/><span/></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          placeholder="Message teammates…"
          value={input}
          onChange={handleInput}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button className={styles.sendBtn} onClick={send}>↑</button>
      </div>
    </div>
  );
}

function roleColor(role) {
  const map = { frontend:'#61dafb', backend:'#10b981', fullstack:'#f59e0b', viewer:'#a78bfa' };
  return map[role] || '#94a3b8';
}
