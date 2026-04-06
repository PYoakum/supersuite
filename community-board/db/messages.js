export async function sendMessage(sql, senderId, recipientId, subject, body) {
  const [msg] = await sql`
    INSERT INTO messages (sender_id, recipient_id, subject, body)
    VALUES (${senderId}, ${recipientId}, ${subject}, ${body})
    RETURNING id, created_at
  `;
  return msg;
}

export async function getInbox(sql, userId, page, perPage) {
  const offset = (page - 1) * perPage;
  return sql`
    SELECT m.id, m.subject, m.created_at, m.read_at,
           u.username AS sender_username, u.id AS sender_id
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.recipient_id = ${userId} AND m.deleted_by_recipient = FALSE
    ORDER BY m.created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;
}

export async function getInboxCount(sql, userId) {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM messages
    WHERE recipient_id = ${userId} AND deleted_by_recipient = FALSE
  `;
  return count;
}

export async function getSent(sql, userId, page, perPage) {
  const offset = (page - 1) * perPage;
  return sql`
    SELECT m.id, m.subject, m.created_at, m.read_at,
           u.username AS recipient_username, u.id AS recipient_id
    FROM messages m
    JOIN users u ON u.id = m.recipient_id
    WHERE m.sender_id = ${userId} AND m.deleted_by_sender = FALSE
    ORDER BY m.created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;
}

export async function getSentCount(sql, userId) {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM messages
    WHERE sender_id = ${userId} AND deleted_by_sender = FALSE
  `;
  return count;
}

export async function getMessageById(sql, id) {
  const [msg] = await sql`
    SELECT m.id, m.sender_id, m.recipient_id, m.subject, m.body,
           m.read_at, m.deleted_by_sender, m.deleted_by_recipient, m.created_at,
           s.username AS sender_username,
           r.username AS recipient_username
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    JOIN users r ON r.id = m.recipient_id
    WHERE m.id = ${id}
  `;
  return msg || null;
}

export async function markRead(sql, id) {
  await sql`
    UPDATE messages SET read_at = NOW() WHERE id = ${id} AND read_at IS NULL
  `;
}

export async function softDeleteMessage(sql, id, userId) {
  // Determine if user is sender or recipient and set the appropriate flag
  const msg = await getMessageById(sql, id);
  if (!msg) return;

  if (msg.sender_id === userId) {
    await sql`UPDATE messages SET deleted_by_sender = TRUE WHERE id = ${id}`;
  }
  if (msg.recipient_id === userId) {
    await sql`UPDATE messages SET deleted_by_recipient = TRUE WHERE id = ${id}`;
  }
}

export async function getUnreadCount(sql, userId) {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM messages
    WHERE recipient_id = ${userId} AND read_at IS NULL AND deleted_by_recipient = FALSE
  `;
  return count;
}
