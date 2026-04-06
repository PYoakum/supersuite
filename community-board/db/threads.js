export async function getThreadsForCategory(sql, categoryId, page, perPage) {
  const offset = (page - 1) * perPage;
  return sql`
    SELECT t.id, t.title, t.is_pinned, t.is_locked, t.reply_count,
           t.last_post_at, t.created_at,
           u.username AS author
    FROM threads t
    JOIN users u ON u.id = t.user_id
    WHERE t.category_id = ${categoryId}
    ORDER BY t.is_pinned DESC, t.last_post_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;
}

export async function findThreadById(sql, id) {
  const [thread] = await sql`
    SELECT t.id, t.category_id, t.user_id, t.title, t.is_pinned, t.is_locked,
           t.reply_count, t.last_post_at, t.created_at,
           u.username AS author,
           c.slug AS category_slug, c.name AS category_name
    FROM threads t
    JOIN users u ON u.id = t.user_id
    JOIN categories c ON c.id = t.category_id
    WHERE t.id = ${id}
  `;
  return thread || null;
}

export async function createThread(sql, categoryId, userId, title, body, contentTag, imageFiles = []) {
  const { createImages } = await import("./images.js");
  return sql.begin(async (tx) => {
    const [thread] = await tx`
      INSERT INTO threads (category_id, user_id, title)
      VALUES (${categoryId}, ${userId}, ${title})
      RETURNING id, category_id, title, created_at
    `;

    const [post] = await tx`
      INSERT INTO posts (thread_id, user_id, body, content_tag)
      VALUES (${thread.id}, ${userId}, ${body}, ${contentTag || null})
      RETURNING id
    `;

    if (imageFiles.length) {
      await createImages(tx, post.id, imageFiles);
    }

    await tx`UPDATE categories SET thread_count = thread_count + 1, post_count = post_count + 1 WHERE id = ${categoryId}`;
    await tx`UPDATE users SET post_count = post_count + 1 WHERE id = ${userId}`;

    return thread;
  });
}

export async function getThreadCountForCategory(sql, categoryId) {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM threads WHERE category_id = ${categoryId}
  `;
  return count;
}
