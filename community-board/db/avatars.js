export async function upsertAvatar(sql, userId, file) {
  const buf = Buffer.from(await file.arrayBuffer());
  await sql`
    INSERT INTO user_avatars (user_id, filename, mime_type, data, size)
    VALUES (${userId}, ${file.name}, ${file.type}, ${buf}, ${file.size})
    ON CONFLICT (user_id) DO UPDATE SET
      filename = EXCLUDED.filename,
      mime_type = EXCLUDED.mime_type,
      data = EXCLUDED.data,
      size = EXCLUDED.size,
      updated_at = NOW()
  `;
}

export async function getAvatar(sql, userId) {
  const [avatar] = await sql`
    SELECT user_id, filename, mime_type, data, size, updated_at
    FROM user_avatars
    WHERE user_id = ${userId}
  `;
  return avatar || null;
}

export async function deleteAvatar(sql, userId) {
  await sql`DELETE FROM user_avatars WHERE user_id = ${userId}`;
}
