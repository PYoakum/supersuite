import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, refreshTokens, calendars } from '../../db/schema';
import { signAccessToken, signRefreshToken, verifyToken } from '../../lib/jwt';
import { ConflictError, UnauthorizedError, NotFoundError } from '../../lib/errors';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import type { RegisterInput, LoginInput, UpdateProfileInput } from './auth.validators';

const SALT_ROUNDS = 12;

export async function register(input: RegisterInput) {
  // Check for existing user
  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      name: input.name,
      timezone: input.timezone || 'UTC',
    })
    .returning();

  // Create default calendar for new user
  await db.insert(calendars).values({
    userId: user.id,
    name: 'Personal',
    color: '#3B82F6',
    isDefault: true,
  });

  logger.info({ userId: user.id }, 'User registered');

  return issueTokens(user.id, user.email);
}

export async function login(input: LoginInput) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  logger.info({ userId: user.id }, 'User logged in');

  return issueTokens(user.id, user.email);
}

export async function refresh(token: string) {
  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Verify token exists in database (not revoked)
  const tokenHash = await hashToken(token);
  const stored = await db.query.refreshTokens.findFirst({
    where: eq(refreshTokens.tokenHash, tokenHash),
  });
  if (!stored || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired or revoked');
  }

  // Rotate: delete old token, issue new pair
  await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));

  return issueTokens(payload.sub, payload.email);
}

export async function logout(token: string) {
  const tokenHash = await hashToken(token);
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function getCurrentUser(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    throw new NotFoundError('User');
  }
  // Strip password hash from response
  const { passwordHash: _, ...safeUser } = user;
  return safeUser;
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.preferences !== undefined) {
    // Merge with existing preferences
    const current = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!current) throw new NotFoundError('User');
    updates.preferences = { ...(current.preferences as object), ...input.preferences };
  }

  if (Object.keys(updates).length === 0) {
    return getCurrentUser(userId);
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning();

  const { passwordHash: _, ...safeUser } = updated;
  return safeUser;
}

// ── Internal helpers ───────────────────────────────────────

async function issueTokens(userId: string, email: string) {
  const payload = { sub: userId, email };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);

  // Store refresh token hash in database
  const tokenHash = await hashToken(refreshToken);
  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + config.jwt.refreshExpiresInMs),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 900, // 15 minutes in seconds
  };
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
