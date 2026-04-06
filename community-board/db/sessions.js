export async function createSession(sql, userId, tokenHash, expiresAt) {
  const [session] = await sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
    RETURNING id
  `;
  return session;
}

export async function findSessionByTokenHash(sql, tokenHash) {
  const [session] = await sql`
    SELECT s.id, s.user_id, s.expires_at,
           u.id AS uid, u.username, u.role, u.post_count, u.created_at AS user_created_at,
           u.can_post, u.can_create_threads, u.suspended_until, u.suspension_reason
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > NOW()
  `;
  if (!session) return null;
  return {
    session: { id: session.id, user_id: session.user_id, expires_at: session.expires_at },
    user: {
      id: session.uid,
      username: session.username,
      role: session.role,
      post_count: session.post_count,
      created_at: session.user_created_at,
      can_post: session.can_post,
      can_create_threads: session.can_create_threads,
      suspended_until: session.suspended_until,
      suspension_reason: session.suspension_reason,
    },
  };
}

export async function deleteSession(sql, tokenHash) {
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

export async function cleanExpiredSessions(sql) {
  const result = await sql`DELETE FROM sessions WHERE expires_at <= NOW()`;
  if (result.count > 0) {
    console.log(`Cleaned ${result.count} expired sessions`);
  }
}
