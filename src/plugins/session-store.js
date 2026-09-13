import { db } from '../../database/connection.js';

export class SQLiteSessionStore {
  constructor() {
    // Garante que sessoes expiradas sejam limpas sem prender o event loop
    this.cleanExpiredSessions();
    const interval = setInterval(() => this.cleanExpiredSessions(), 15 * 60 * 1000);
    if (interval.unref) {
      interval.unref();
    }
  }

  get(sessionId, callback) {
    try {
      const row = db.prepare('SELECT sessionData, expiresAt FROM sessions WHERE sessionId = ?').get(sessionId);
      if (!row) return callback(null, null);

      if (row.expiresAt <= Date.now()) {
        this.destroy(sessionId, () => {});
        return callback(null, null);
      }

      const session = JSON.parse(row.sessionData);
      return callback(null, session);
    } catch (err) {
      return callback(err);
    }
  }

  set(sessionId, session, callback) {
    try {
      const maxAge = session?.cookie?.maxAge || 24 * 60 * 60 * 1000;
      const expiresAt = Date.now() + maxAge;
      const sessionData = JSON.stringify(session);

      const stmt = db.prepare(`
        INSERT INTO sessions (sessionId, sessionData, expiresAt)
        VALUES (?, ?, ?)
        ON CONFLICT(sessionId) DO UPDATE SET
          sessionData = excluded.sessionData,
          expiresAt = excluded.expiresAt
      `);
      stmt.run(sessionId, sessionData, expiresAt);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  destroy(sessionId, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sessionId = ?').run(sessionId);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  cleanExpiredSessions() {
    try {
      db.prepare('DELETE FROM sessions WHERE expiresAt <= ?').run(Date.now());
    } catch (err) {
      console.error('[SESSION CLEANUP ERROR]', err);
    }
  }
}
