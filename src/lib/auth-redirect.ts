/** Only library routes can override the default post-login destination. */
export function loginDestination(value: string | null | undefined): string {
  if (!value || value.length > 2048 || /[\p{Cc}\s\\]/u.test(value)) {
    return '/admin';
  }
  try {
    const url = new URL(value, 'https://login.invalid');
    if (!value.startsWith('/') || url.origin !== 'https://login.invalid') return '/admin';
    if (!/^\/private-library(?:\/[a-zA-Z0-9_-]+)?\/?$/.test(url.pathname)) return '/admin';
    return url.pathname + url.search;
  } catch {
    return '/admin';
  }
}
