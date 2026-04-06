export async function getPostsForThread(sql, threadId, page, perPage) {
  const offset = (page - 1) * perPage;
  return sql`
    SELECT p.id, p.body, p.created_at, p.updated_at, p.content_tag, p.parent_post_id,
           u.id AS user_id, u.username, u.role, u.post_count AS user_post_count
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.thread_id = ${threadId}
    ORDER BY p.created_at ASC
    LIMIT ${perPage} OFFSET ${offset}
  `;
}

export async function getPostCountForThread(sql, threadId) {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM posts WHERE thread_id = ${threadId}
  `;
  return count;
}

export async function getPostById(sql, postId) {
  const [post] = await sql`
    SELECT p.id, p.thread_id, p.user_id, p.body, p.created_at, p.updated_at, p.content_tag, p.parent_post_id
    FROM posts p
    WHERE p.id = ${postId}
  `;
  return post || null;
}

export async function getPostsByIds(sql, postIds) {
  if (!postIds.length) return [];
  return sql`
    SELECT p.id, p.body, p.user_id, u.username
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ANY(${postIds})
  `;
}

export async function updatePost(sql, postId, newBody, contentTag) {
  await sql`
    UPDATE posts SET body = ${newBody}, content_tag = ${contentTag ?? null}, updated_at = NOW()
    WHERE id = ${postId}
  `;
}

export async function createReply(sql, threadId, categoryId, userId, body, parentPostId, contentTag, imageFiles = []) {
  const { createImages } = await import("./images.js");
  return sql.begin(async (tx) => {
    const [post] = await tx`
      INSERT INTO posts (thread_id, user_id, body, parent_post_id, content_tag)
      VALUES (${threadId}, ${userId}, ${body}, ${parentPostId || null}, ${contentTag || null})
      RETURNING id, created_at
    `;

    if (imageFiles.length) {
      await createImages(tx, post.id, imageFiles);
    }

    await tx`UPDATE threads SET reply_count = reply_count + 1, last_post_at = NOW() WHERE id = ${threadId}`;
    await tx`UPDATE categories SET post_count = post_count + 1 WHERE id = ${categoryId}`;
    await tx`UPDATE users SET post_count = post_count + 1 WHERE id = ${userId}`;

    return post;
  });
}
