export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function nowIso() {
  return new Date().toISOString();
}

export function trimText(value, maxLength = 10_000) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, maxLength);
}

export function buildDisplayName(userLike) {
  return (
    userLike?.nickname ||
    [userLike?.firstName, userLike?.lastName].filter(Boolean).join(' ').trim() ||
    userLike?.username ||
    'Слушатель'
  );
}

export function ensureRange(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  return Math.min(max, Math.max(min, numeric));
}

export function slugAvatarInitials(name) {
  return String(name || 'D')
    .trim()
    .slice(0, 2)
    .toUpperCase();
}
