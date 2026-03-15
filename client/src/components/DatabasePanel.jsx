import React, { useState, useEffect } from 'react';
import axios from 'axios';
import styles from './DatabasePanel.module.css';

const DB_TYPES = {
  postgresql: { icon: '🐘', color: '#336791', label: 'PostgreSQL', placeholder: 'postgres://user:password@host:5432/dbname' },
  mysql:      { icon: '🐬', color: '#00758f', label: 'MySQL',      placeholder: 'mysql://user:password@host:3306/dbname' },
  mongodb:    { icon: '🍃', color: '#10aa50', label: 'MongoDB',    placeholder: 'mongodb+srv://user:password@cluster.mongodb.net/dbname' },
  redis:      { icon: '🔴', color: '#d82c20', label: 'Redis',      placeholder: 'redis://user:password@host:6379' },
  sqlite:     { icon: '📦', color: '#84b4c8', label: 'SQLite',     placeholder: '/absolute/path/to/db.sqlite  or  :memory:' },
};

const CODE_SNIPPETS = {
  postgresql: {
    node: `const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Usage:
const { rows } = await pool.query('SELECT * FROM users');`,
    python: `import psycopg2, os
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute("SELECT * FROM users")
rows = cur.fetchall()`,
  },
  mysql: {
    node: `const mysql = require('mysql2/promise');
const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Usage:
const [rows] = await conn.execute('SELECT * FROM users');`,
    python: `import mysql.connector, os
conn = mysql.connector.connect(host=os.environ['DB_HOST'])
cursor = conn.cursor()
cursor.execute("SELECT * FROM users")`,
  },
  mongodb: {
    node: `const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();

// Usage:
const users = await db.collection('users').find().toArray();`,
    python: `from pymongo import MongoClient
import os
client = MongoClient(os.environ['MONGODB_URI'])
db = client.get_default_database()
users = list(db.users.find())`,
  },
  redis: {
    node: `const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });
await client.connect();

// Usage:
await client.set('key', 'value');
const val = await client.get('key');`,
    python: `import redis, os
r = redis.from_url(os.environ['REDIS_URL'])
r.set('key', 'value')
val = r.get('key')`,
  },
  sqlite: {
    node: `const Database = require('better-sqlite3');
const db = new Database(process.env.SQLITE_PATH || ':memory:');

// Usage:
const rows = db.prepare('SELECT * FROM users').all();`,
    python: `import sqlite3, os
conn = sqlite3.connect(os.environ.get('SQLITE_PATH', ':memory:'))
cur = conn.cursor()
cur.execute("SELECT * FROM users")
rows = cur.fetchall()`,
  },
};

export default function DatabasePanel({ roomCode }) {
  const [status, setStatus] = useState(null); // null = loading
  const [connectionString, setConnectionString] = useState('');
  const [label, setLabel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, message } | null
  const [codeTab, setCodeTab] = useState('node');
  const [showString, setShowString] = useState(false);

  // Load current DB status on mount
  useEffect(() => {
    axios.get(`/api/rooms/${roomCode}/db`)
      .then(r => setStatus(r.data))
      .catch(() => setStatus({ connected: false }));
  }, [roomCode]);

  const detectedType = detectTypeFromString(connectionString);
  const dbMeta = DB_TYPES[detectedType] || DB_TYPES[status?.type] || null;

  async function handleConnect() {
    if (!connectionString.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post(`/api/rooms/${roomCode}/db`, {
        connectionString: connectionString.trim(),
        label: label.trim(),
      });
      setTestResult({ ok: true, message: res.data.message });
      setStatus({
        connected: true,
        type: res.data.type,
        maskedUrl: maskLocal(connectionString),
        envVars: res.data.envVars,
        connectedAt: Date.now(),
      });
      setConnectionString('');
      setLabel('');
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.error || err.message });
    }
    setTesting(false);
  }

  async function handleDisconnect() {
    await axios.delete(`/api/rooms/${roomCode}/db`).catch(() => {});
    setStatus({ connected: false });
    setTestResult(null);
  }

  const snippets = CODE_SNIPPETS[status?.type] || CODE_SNIPPETS[detectedType] || null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🗄</span>
        <span className={styles.headerTitle}>Database</span>
        {status?.connected && (
          <span className={styles.connectedBadge} style={{ '--dc': DB_TYPES[status.type]?.color || '#10b981' }}>
            {DB_TYPES[status.type]?.icon} connected
          </span>
        )}
      </div>

      {/* ── CONNECTED STATE ── */}
      {status?.connected ? (
        <div className={styles.connectedState}>
          <div className={styles.dbCard} style={{ '--dc': DB_TYPES[status.type]?.color || '#10b981' }}>
            <div className={styles.dbCardIcon}>{DB_TYPES[status.type]?.icon || '🗄'}</div>
            <div className={styles.dbCardInfo}>
              <div className={styles.dbCardType}>{DB_TYPES[status.type]?.label || status.type}</div>
              <div className={styles.dbCardUrl}>{status.maskedUrl}</div>
              {status.connectedAt && (
                <div className={styles.dbCardTime}>
                  linked {formatRelative(status.connectedAt)}
                </div>
              )}
            </div>
          </div>

          {/* Env vars injected */}
          {status.envVars?.length > 0 && (
            <div className={styles.envSection}>
              <div className={styles.envTitle}>Injected env vars</div>
              <div className={styles.envList}>
                {status.envVars.map(v => (
                  <div key={v} className={styles.envVar}>
                    <span className={styles.envKey}>{v}</span>
                    <span className={styles.envVal}>= "****"</span>
                  </div>
                ))}
              </div>
              <div className={styles.envNote}>
                These are available in your backend code via <code>process.env</code> or <code>os.environ</code>
              </div>
            </div>
          )}

          {/* Code snippets */}
          {snippets && (
            <div className={styles.snippetSection}>
              <div className={styles.snippetHeader}>
                <span className={styles.snippetTitle}>How to use in your code</span>
                <div className={styles.snippetTabs}>
                  <button className={`${styles.stab} ${codeTab === 'node' ? styles.stabOn : ''}`} onClick={() => setCodeTab('node')}>Node.js</button>
                  <button className={`${styles.stab} ${codeTab === 'python' ? styles.stabOn : ''}`} onClick={() => setCodeTab('python')}>Python</button>
                </div>
              </div>
              <pre className={styles.snippet}>{snippets[codeTab]}</pre>
            </div>
          )}

          <button className={styles.disconnectBtn} onClick={handleDisconnect}>
            ✕ Disconnect database
          </button>
        </div>
      ) : (
        /* ── CONNECT FORM ── */
        <div className={styles.connectForm}>
          <p className={styles.intro}>
            Link a database to your project. The connection string is injected as environment variables when you run your backend.
          </p>

          {/* Quick DB type picker */}
          <div className={styles.typePicker}>
            {Object.entries(DB_TYPES).map(([key, meta]) => (
              <button
                key={key}
                className={`${styles.typeBtn} ${detectedType === key ? styles.typeBtnOn : ''}`}
                style={{ '--tc': meta.color }}
                onClick={() => setConnectionString(meta.placeholder)}
                title={meta.label}
              >
                <span>{meta.icon}</span>
                <span>{meta.label}</span>
              </button>
            ))}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Connection String</label>
            <div className={styles.inputWrap}>
              <input
                className={styles.input}
                type={showString ? 'text' : 'password'}
                placeholder={dbMeta?.placeholder || 'postgres://user:password@host:5432/dbname'}
                value={connectionString}
                onChange={e => { setConnectionString(e.target.value); setTestResult(null); }}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                autoComplete="off"
                spellCheck={false}
              />
              <button className={styles.eyeBtn} onClick={() => setShowString(v => !v)} title={showString ? 'Hide' : 'Show'}>
                {showString ? '🙈' : '👁'}
              </button>
            </div>
            {detectedType && detectedType !== 'unknown' && (
              <div className={styles.detectedType} style={{ color: DB_TYPES[detectedType]?.color }}>
                {DB_TYPES[detectedType]?.icon} Detected: {DB_TYPES[detectedType]?.label}
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Nickname <span className={styles.optional}>(optional)</span></label>
            <input
              className={styles.input}
              placeholder="e.g. Production DB, My Atlas cluster…"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </div>

          {testResult && (
            <div className={`${styles.result} ${testResult.ok ? styles.resultOk : styles.resultErr}`}>
              {testResult.ok ? '✓' : '✗'} {testResult.message}
            </div>
          )}

          <button
            className={styles.connectBtn}
            onClick={handleConnect}
            disabled={testing || !connectionString.trim()}
          >
            {testing ? (
              <><span className={styles.spinner} /> Testing connection…</>
            ) : (
              '⚡ Test & Connect'
            )}
          </button>

          <div className={styles.secNote}>
            🔒 Your connection string is stored only in server memory and never written to disk or logs. It is masked in the UI.
          </div>
        </div>
      )}
    </div>
  );
}

// ── helpers ──
function detectTypeFromString(s) {
  if (!s) return null;
  const l = s.trim().toLowerCase();
  if (l.startsWith('postgres://') || l.startsWith('postgresql://')) return 'postgresql';
  if (l.startsWith('mysql://') || l.startsWith('mysql2://'))        return 'mysql';
  if (l.startsWith('mongodb://') || l.startsWith('mongodb+srv://')) return 'mongodb';
  if (l.startsWith('redis://') || l.startsWith('rediss://'))        return 'redis';
  if (l.endsWith('.db') || l.endsWith('.sqlite') || l === ':memory:') return 'sqlite';
  return null;
}

function maskLocal(s) {
  try {
    const url = new URL(s);
    if (url.password) url.password = '****';
    return url.toString();
  } catch (_) {
    return s.replace(/:([^@/]{3,})@/, ':****@');
  }
}

function formatRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  return Math.floor(diff / 3600000) + 'h ago';
}
