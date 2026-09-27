/** Generate initials avatar data URL from display name */
export function initialsAvatar(name, size = 64) {
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const colors = [
    '#58a6ff', '#3fb950', '#d2a8ff', '#f778ba',
    '#ffa657', '#79c0ff', '#56d364', '#e3b341',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const bg = colors[Math.abs(hash) % colors.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${bg}"/>
    <text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="#0d1117" font-family="system-ui,sans-serif" font-weight="700" font-size="${size * 0.4}">${initials}</text>
  </svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function avatarSrc(user) {
  if (user?.avatarUrl) return user.avatarUrl;
  return initialsAvatar(user?.displayName || user?.username || '?');
}
