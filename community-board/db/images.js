export async function createImages(tx, postId, files) {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const buf = Buffer.from(await f.arrayBuffer());
    await tx`
      INSERT INTO post_images (post_id, filename, mime_type, data, size, position)
      VALUES (${postId}, ${f.name}, ${f.type}, ${buf}, ${f.size}, ${i})
    `;
  }
}

export async function getImagesForPosts(sql, postIds) {
  if (!postIds.length) return [];
  return sql`
    SELECT id, post_id, filename, mime_type, size, position
    FROM post_images
    WHERE post_id = ANY(${postIds})
    ORDER BY post_id, position
  `;
}

export async function getImageById(sql, id) {
  const [img] = await sql`
    SELECT id, post_id, filename, mime_type, data, size
    FROM post_images
    WHERE id = ${id}
  `;
  return img || null;
}
