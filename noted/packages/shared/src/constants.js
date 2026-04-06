/** User roles */
export const ROLES = {
  VIEWER: 'viewer',
  EDITOR: 'editor',
  ADMIN: 'admin',
};

/** Document permission levels */
export const DOC_ROLES = {
  VIEWER: 'viewer',
  EDITOR: 'editor',
};

/** Media kinds */
export const MEDIA_KINDS = {
  IMAGE: 'image',
  VIDEO: 'video',
};

/** Defaults */
export const DEFAULTS = {
  AUTOSAVE_DEBOUNCE_MS: 800,
  SESSION_MAX_AGE_SECONDS: 60 * 60 * 24 * 30, // 30 days
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024, // 50 MB
  SLUG_MAX_LENGTH: 200,
};
