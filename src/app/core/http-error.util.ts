import { HttpErrorResponse } from '@angular/common/http';

const GENERIC_HTTP_TITLES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Internal Server Error',
  'Service Unavailable',
]);

export function extractApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const fromBody = extractMessageFromBody(err.error);
    if (fromBody) {
      return fromBody;
    }
  }
  if (err && typeof err === 'object' && 'error' in err) {
    const fromBody = extractMessageFromBody((err as { error?: unknown }).error);
    if (fromBody) {
      return fromBody;
    }
  }
  return fallback;
}

function extractMessageFromBody(body: unknown): string | null {
  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }
  if (!body || typeof body !== 'object') {
    return null;
  }
  const o = body as Record<string, unknown>;

  const detail = pickNonEmptyString(o['detail']);
  if (detail) {
    return detail;
  }

  const message = pickNonEmptyString(o['message']);
  if (message) {
    return message;
  }

  const title = pickNonEmptyString(o['title']);
  if (title && !GENERIC_HTTP_TITLES.has(title)) {
    return title;
  }

  return null;
}

function pickNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const t = value.trim();
  return t.length > 0 ? t : null;
}
