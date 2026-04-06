export async function getSetting(sql, key) {
  const [row] = await sql`
    SELECT value FROM site_settings WHERE key = ${key}
  `;
  return row ? row.value : null;
}

export async function setSetting(sql, key, value) {
  await sql`
    INSERT INTO site_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function deleteSetting(sql, key) {
  await sql`DELETE FROM site_settings WHERE key = ${key}`;
}
