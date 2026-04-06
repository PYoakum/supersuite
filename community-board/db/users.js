export async function createUser(sql, username, passwordHash, role = "user") {
  const [user] = await sql`
    INSERT INTO users (username, password_hash, role)
    VALUES (${username}, ${passwordHash}, ${role})
    RETURNING id, username, role, post_count, created_at
  `;
  return user;
}

export async function findUserByUsername(sql, username) {
  const [user] = await sql`
    SELECT id, username, password_hash, role, post_count, created_at,
           can_post, can_create_threads, suspended_until, suspension_reason
    FROM users WHERE username = ${username}
  `;
  return user || null;
}

export async function findUserById(sql, id) {
  const [user] = await sql`
    SELECT id, username, role, post_count, created_at,
           can_post, can_create_threads, suspended_until, suspension_reason
    FROM users WHERE id = ${id}
  `;
  return user || null;
}

export async function getUserCount(sql) {
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
  return count;
}

export async function findUserPublicByUsername(sql, username) {
  const [user] = await sql`
    SELECT id, username, role, post_count, created_at
    FROM users WHERE username = ${username}
  `;
  return user || null;
}

export async function getRecentPostsByUser(sql, userId, limit = 20) {
  return sql`
    SELECT p.id, p.body, p.created_at,
           t.id AS thread_id, t.title AS thread_title,
           c.slug AS category_slug
    FROM posts p
    JOIN threads t ON t.id = p.thread_id
    JOIN categories c ON c.id = t.category_id
    WHERE p.user_id = ${userId}
    ORDER BY p.created_at DESC
    LIMIT ${limit}
  `;
}
