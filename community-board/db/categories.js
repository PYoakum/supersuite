export async function getAllCategories(sql) {
  return sql`
    SELECT id, slug, name, description, position, thread_count, post_count, created_at
    FROM categories ORDER BY position ASC, id ASC
  `;
}

export async function findCategoryBySlug(sql, slug) {
  const [category] = await sql`
    SELECT id, slug, name, description, position, thread_count, post_count, created_at
    FROM categories WHERE slug = ${slug}
  `;
  return category || null;
}

export async function findCategoryById(sql, id) {
  const [category] = await sql`
    SELECT id, slug, name, description, position, thread_count, post_count, created_at
    FROM categories WHERE id = ${id}
  `;
  return category || null;
}

export async function createCategory(sql, slug, name, description, position) {
  const [category] = await sql`
    INSERT INTO categories (slug, name, description, position)
    VALUES (${slug}, ${name}, ${description || ""}, ${position || 0})
    RETURNING id, slug, name, description, position, thread_count, post_count, created_at
  `;
  return category;
}

export async function updateCategory(sql, id, { name, description, position }) {
  const [category] = await sql`
    UPDATE categories
    SET name = COALESCE(${name}, name),
        description = COALESCE(${description}, description),
        position = COALESCE(${position ?? null}, position)
    WHERE id = ${id}
    RETURNING id, slug, name, description, position
  `;
  return category || null;
}

export async function deleteCategory(sql, id) {
  await sql`DELETE FROM categories WHERE id = ${id}`;
}
