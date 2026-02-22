const HTML_TAG_RE = /<[^>]*>/;

export function validatePlayerName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return 'Name is required';
  if (trimmed.length > 50) return 'Name must be 50 characters or fewer';
  if (HTML_TAG_RE.test(trimmed)) return 'Name contains invalid characters';
  return null;
}

export function validateSessionCode(code: string): string | null {
  const trimmed = code.trim();
  if (trimmed.length !== 6) return 'Session code must be 6 characters';
  if (!/^[A-Z0-9]{6}$/i.test(trimmed)) return 'Session code must be alphanumeric';
  return null;
}

export function validateOrganization(org: string): string | null {
  if (org.length > 100) return 'Organization must be 100 characters or fewer';
  if (HTML_TAG_RE.test(org)) return 'Organization contains invalid characters';
  return null;
}
