import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser, User } from '@/types/domain';
import { DatabaseError, execute, queryOne } from './client';

interface UserRow {
  id: string;
  github_id: string;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string;
  bio: string;
  role: 'user' | 'admin';
  created_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  expires_at: string;
  username: string;
  display_name: string;
  avatar_url: string;
  role: 'user' | 'admin';
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.github_id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    role: row.role,
    createdAt: row.created_at
  };
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await queryOne<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
  return row ? mapUser(row) : null;
}

export async function getUserByGithubId(db: D1Database, githubId: string): Promise<User | null> {
  const row = await queryOne<UserRow>(db, 'SELECT * FROM users WHERE github_id = ? AND deleted_at IS NULL LIMIT 1', [githubId]);
  return row ? mapUser(row) : null;
}

export async function upsertUser(db: D1Database, input: {
  id: string;
  githubId: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  role: 'user' | 'admin';
}): Promise<User> {
  const existing = await getUserByGithubId(db, input.githubId);
  if (existing) {
    try {
      await execute(
        db,
        `UPDATE users SET
           username = ?,
           display_name = ?,
           email = ?,
           avatar_url = ?,
           role = CASE WHEN role = 'admin' THEN 'admin' ELSE ? END,
           updated_at = datetime('now'),
           updated_by = ?
         WHERE id = ?`,
        [input.username, input.displayName, input.email, input.avatarUrl, input.role, existing.id, existing.id]
      );
    } catch (error) {
      // Published archive-linked author fields are frozen. Identity/email/role sync must not break login.
      const cause = error instanceof DatabaseError ? error.cause : null;
      if (!(cause instanceof Error) || !cause.message.includes('ARCHIVE_PUBLICATION_CONFIRM_REQUIRED')) { throw error; }
      await execute(db,
        "UPDATE users SET email = ?, role = CASE WHEN role = 'admin' THEN 'admin' ELSE ? END, " +
        "updated_at = datetime('now'), updated_by = ? WHERE id = ? AND github_id = ? AND deleted_at IS NULL",
        [input.email, input.role, existing.id, existing.id, input.githubId]);
    }
    const updated = await getUserByGithubId(db, input.githubId);
    if (!updated) {
      throw new Error('用户更新后读取失败');
    }
    return updated;
  }
  await execute(
    db,
    `INSERT INTO users (id, github_id, username, display_name, email, avatar_url, role, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    [input.id, input.githubId, input.username, input.displayName, input.email, input.avatarUrl, input.role, input.id]
  );
  const user = await getUserByGithubId(db, input.githubId);
  if (!user) {
    throw new Error('用户写入后读取失败');
  }
  return user;
}

export async function createSession(db: D1Database, input: { id: string; userId: string; tokenHash: string; csrfToken: string; expiresAt: string }): Promise<void> {
  await execute(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [input.id, input.userId, input.tokenHash, input.csrfToken, input.expiresAt]
  );
}

export async function getSessionUser(db: D1Database, tokenHash: string): Promise<SessionUser | null> {
  const row = await queryOne<SessionRow>(
    db,
    `SELECT s.id, s.user_id, s.token_hash, s.csrf_token, s.expires_at,
            u.username, u.display_name, u.avatar_url, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.deleted_at IS NULL AND s.expires_at > datetime('now') AND u.deleted_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );
  if (!row) {
    return null;
  }
  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name || row.username,
    avatarUrl: row.avatar_url,
    role: row.role,
    csrfToken: row.csrf_token
  };
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await execute(db, 'UPDATE sessions SET deleted_at = datetime(\'now\') WHERE token_hash = ? AND deleted_at IS NULL', [tokenHash]);
}

export async function createOAuthState(db: D1Database, state: string, codeVerifier: string, redirectUri: string, expiresAt: string): Promise<void> {
  await execute(db, 'INSERT INTO oauth_states (state, code_verifier, redirect_uri, expires_at) VALUES (?, ?, ?, ?)', [state, codeVerifier, redirectUri, expiresAt]);
}

export async function consumeOAuthState(db: D1Database, state: string): Promise<{ codeVerifier: string; redirectUri: string } | null> {
  const row = await queryOne<{ code_verifier: string; redirect_uri: string }>(
    db,
    'SELECT code_verifier, redirect_uri FROM oauth_states WHERE state = ? AND expires_at > datetime(\'now\') LIMIT 1',
    [state]
  );
  if (!row) {
    return null;
  }
  await execute(db, 'DELETE FROM oauth_states WHERE state = ?', [state]);
  return { codeVerifier: row.code_verifier, redirectUri: row.redirect_uri };
}
