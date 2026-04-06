export async function savePost(sql, userId, postId) {
  await sql`
    INSERT INTO saved_posts (user_id, post_id)
    VALUES (${userId}, ${postId})
    ON CONFLICT (user_id, post_id) DO NOTHING
  `;
}

export async function unsavePost(sql, userId, postId) {
  await sql`
    DELETE FROM saved_posts WHERE user_id = ${userId} AND post_id = ${postId}
  `;
}

export async function getSavedPostIdsForUser(sql, userId, postIds) {
  if (!postIds.length) return new Set();
  const rows = await sql`
    SELECT post_id FROM saved_posts
    WHERE user_id = ${userId} AND post_id = ANY(${postIds})
  `;
  return new Set(rows.map((r) => r.post_id));
}

export async function getSavedPostsForUser(sql, userId, limit = 20) {
  return sql`
    SELECT sp.created_at AS saved_at,
           p.id, p.body, p.created_at,
           t.id AS thread_id, t.title AS thread_title,
           c.slug AS category_slug,
           u.username
    FROM saved_posts sp
    JOIN posts p ON p.id = sp.post_id
    JOIN threads t ON t.id = p.thread_id
    JOIN categories c ON c.id = t.category_id
    JOIN users u ON u.id = p.user_id
    WHERE sp.user_id = ${userId}
    ORDER BY sp.created_at DESC
    LIMIT ${limit}
  `;
}
