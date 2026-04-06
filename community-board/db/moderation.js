export async function logModAction(sql, adminId, targetUserId, action, details = null) {
  await sql`
    INSERT INTO moderation_log (admin_id, target_user_id, action, details)
    VALUES (${adminId}, ${targetUserId}, ${action}, ${details})
  `;
}

export async function getModLog(sql, targetUserId, limit = 20) {
  return sql`
    SELECT ml.id, ml.action, ml.details, ml.created_at,
           u.username AS admin_username
    FROM moderation_log ml
    JOIN users u ON u.id = ml.admin_id
    WHERE ml.target_user_id = ${targetUserId}
    ORDER BY ml.created_at DESC
    LIMIT ${limit}
  `;
}

export async function logLogin(sql, userId, ipAddress) {
  await sql`
    INSERT INTO login_log (user_id, ip_address)
    VALUES (${userId}, ${ipAddress})
  `;
}

export async function getLoginLog(sql, userId, limit = 20) {
  return sql`
    SELECT id, ip_address, created_at
    FROM login_log
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function updateUserRestrictions(sql, userId, { canPost, canCreateThreads }) {
  await sql`
    UPDATE users
    SET can_post = ${canPost},
        can_create_threads = ${canCreateThreads}
    WHERE id = ${userId}
  `;
}

export async function suspendUser(sql, userId, suspendedUntil, reason) {
  await sql`
    UPDATE users
    SET suspended_until = ${suspendedUntil},
        suspension_reason = ${reason}
    WHERE id = ${userId}
  `;
}

export async function unsuspendUser(sql, userId) {
  await sql`
    UPDATE users
    SET suspended_until = NULL,
        suspension_reason = NULL
    WHERE id = ${userId}
  `;
}

export async function searchUsers(sql, query, page = 1, perPage = 25) {
  const offset = (page - 1) * perPage;
  if (query) {
    const pattern = `%${query}%`;
    return sql`
      SELECT id, username, role, post_count, created_at,
             can_post, can_create_threads, suspended_until
      FROM users
      WHERE username ILIKE ${pattern}
      ORDER BY created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;
  }
  return sql`
    SELECT id, username, role, post_count, created_at,
           can_post, can_create_threads, suspended_until
    FROM users
    ORDER BY created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;
}

export async function getUserCountFiltered(sql, query) {
  if (query) {
    const pattern = `%${query}%`;
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users WHERE username ILIKE ${pattern}`;
    return count;
  }
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
  return count;
}
