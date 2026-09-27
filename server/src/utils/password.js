import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters.' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must be at most 128 characters.' };
  }
  // Reject obviously weak passwords
  const weak = ['password', '12345678', 'qwerty123', 'password1', '11111111'];
  if (weak.includes(password.toLowerCase())) {
    return { valid: false, message: 'Password is too common. Please choose a stronger password.' };
  }
  return { valid: true };
}
