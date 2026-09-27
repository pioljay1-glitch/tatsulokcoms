export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim()) && email.length <= 254;
}

export function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const trimmed = username.trim();
  // 3-32 chars, alphanumeric + underscore, start with letter/number
  return /^[a-zA-Z0-9][a-zA-Z0-9_]{2,31}$/.test(trimmed);
}

export function isValidDisplayName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 64;
}

export function sanitizeString(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}
