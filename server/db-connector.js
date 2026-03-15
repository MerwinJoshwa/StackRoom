/**
 * db-connector.js
 * Tests database connections for StackRoom rooms.
 * Supports: PostgreSQL, MySQL, MongoDB, Redis, SQLite
 *
 * Each test is isolated — we connect, ping, then immediately disconnect.
 * No persistent connections are held by StackRoom itself.
 * The connection string is only injected as an env var into the user's running project.
 */

const { execSync } = require('child_process');

// ─── Detect DB type from connection string ───
function detectDbType(connectionString) {
  const s = connectionString.trim().toLowerCase();
  if (s.startsWith('postgres://') || s.startsWith('postgresql://')) return 'postgresql';
  if (s.startsWith('mysql://') || s.startsWith('mysql2://'))        return 'mysql';
  if (s.startsWith('mongodb://') || s.startsWith('mongodb+srv://')) return 'mongodb';
  if (s.startsWith('redis://') || s.startsWith('rediss://'))        return 'redis';
  if (s.endsWith('.db') || s.endsWith('.sqlite') || s === ':memory:') return 'sqlite';
  return 'unknown';
}

// ─── Ensure a driver package is installed ───
function ensurePackage(pkg) {
  try {
    require.resolve(pkg);
  } catch (_) {
    try {
      execSync(`npm install ${pkg} --no-save --prefer-offline --quiet`, {
        cwd: __dirname,
        stdio: 'ignore',
        timeout: 30000,
      });
    } catch (e) {
      throw new Error(`Could not install ${pkg}: ${e.message}`);
    }
  }
}

// ─── Test PostgreSQL ───
async function testPostgres(connectionString) {
  ensurePackage('pg');
  const { Client } = require('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const res = await client.query('SELECT version()');
    const version = res.rows[0]?.version?.split(' ').slice(0, 2).join(' ') || 'PostgreSQL';
    return { ok: true, message: `Connected ✓  ${version}` };
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

// ─── Test MySQL ───
async function testMySQL(connectionString) {
  ensurePackage('mysql2');
  const mysql = require('mysql2/promise');
  let conn;
  try {
    conn = await mysql.createConnection({ uri: connectionString, connectTimeout: 8000 });
    const [rows] = await conn.execute('SELECT VERSION() as v');
    const version = rows[0]?.v || 'MySQL';
    return { ok: true, message: `Connected ✓  MySQL ${version}` };
  } finally {
    try { if (conn) await conn.end(); } catch (_) {}
  }
}

// ─── Test MongoDB ───
async function testMongo(connectionString) {
  ensurePackage('mongodb');
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(connectionString, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const admin = client.db().admin();
    const info = await admin.serverInfo();
    const version = info?.version || 'MongoDB';
    return { ok: true, message: `Connected ✓  MongoDB ${version}` };
  } finally {
    try { await client.close(); } catch (_) {}
  }
}

// ─── Test Redis ───
async function testRedis(connectionString) {
  ensurePackage('redis');
  const redis = require('redis');
  const client = redis.createClient({
    url: connectionString,
    socket: { connectTimeout: 8000, reconnectStrategy: false },
  });
  return new Promise((resolve, reject) => {
    client.on('error', (err) => {
      client.quit().catch(() => {});
      reject(err);
    });
    client.connect().then(async () => {
      try {
        const pong = await client.ping();
        resolve({ ok: true, message: `Connected ✓  Redis — PING: ${pong}` });
      } catch (e) {
        reject(e);
      } finally {
        client.quit().catch(() => {});
      }
    }).catch(reject);
  });
}

// ─── Test SQLite ───
async function testSQLite(connectionString) {
  ensurePackage('better-sqlite3');
  const Database = require('better-sqlite3');
  try {
    const db = new Database(connectionString === ':memory:' ? ':memory:' : connectionString);
    const row = db.prepare('SELECT sqlite_version() as v').get();
    db.close();
    return { ok: true, message: `Connected ✓  SQLite ${row?.v || ''}` };
  } catch (e) {
    throw e;
  }
}

// ─── Main test function ───
async function testConnection(connectionString) {
  if (!connectionString || !connectionString.trim()) {
    throw new Error('Connection string is empty');
  }

  const type = detectDbType(connectionString.trim());

  switch (type) {
    case 'postgresql': return await testPostgres(connectionString);
    case 'mysql':      return await testMySQL(connectionString);
    case 'mongodb':    return await testMongo(connectionString);
    case 'redis':      return await testRedis(connectionString);
    case 'sqlite':     return await testSQLite(connectionString);
    default:
      throw new Error(
        'Unsupported connection string format.\n' +
        'Supported: postgres://, mysql://, mongodb://, redis://, or a .db file path'
      );
  }
}

// ─── Build env vars to inject into user's project ───
function buildDbEnv(db) {
  if (!db || !db.connectionString) return {};

  const type = detectDbType(db.connectionString);
  const env = {
    DATABASE_URL: db.connectionString,
    DB_URL: db.connectionString,
  };

  // Also add type-specific aliases
  switch (type) {
    case 'postgresql':
      env.POSTGRES_URL = db.connectionString;
      env.PG_URL = db.connectionString;
      break;
    case 'mysql':
      env.MYSQL_URL = db.connectionString;
      break;
    case 'mongodb':
      env.MONGODB_URI = db.connectionString;
      env.MONGO_URL = db.connectionString;
      break;
    case 'redis':
      env.REDIS_URL = db.connectionString;
      break;
    case 'sqlite':
      env.SQLITE_PATH = db.connectionString;
      break;
  }

  return env;
}

module.exports = { testConnection, buildDbEnv, detectDbType };
