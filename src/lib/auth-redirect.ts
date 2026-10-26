/** Allow only known local reading/login destinations, never API or external URLs. */
export function loginDestination(value: string | null | undefined): string {
  if (!value || value.length > 2048 || /[\p{Cc}\s\\]/u.test(value)) return '/';
  try {
    const url = new URL(value, 'https://login.invalid');
    if (!value.startsWith('/') || url.origin !== 'https://login.invalid') return '/';
    if (!/^\/(?:guestbook\/?|post(?:\/[a-zA-Z0-9_-]+)?\/?|private(?:\/[a-zA-Z0-9_-]+)?\/?|admin(?:\/editor)?\/?)?$/.test(url.pathname)) return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

/** Authentication is public; the workspace and private library are owner-only. */
export function authorizedLoginDestination(value: string | null | undefined, role?: string): string {
  const destination = loginDestination(value);
  return role !== 'admin' && /^\/(?:admin|private)(?:\/|\?|$)/.test(destination) ? '/' : destination;
}
