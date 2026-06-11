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
  if (err instanceof Error && err.message.trim() && !(err instanceof HttpErrorResponse)) {
    const msg = err.message.trim();
    if (!msg.toLowerCase().includes('http failure')) {
      return msg;
    }
  }

  if (err instanceof HttpErrorResponse) {
    const fromBody = extractMessageFromBody(err.error);
    if (fromBody) {
      return fromBody;
    }
    const statusMsg = statusFallback(err.status);
    if (statusMsg) {
      return statusMsg;
    }
  }

  if (err && typeof err === 'object') {
    const maybe = err as { error?: unknown; message?: unknown; status?: unknown };
    const fromNested = extractMessageFromBody(maybe.error);
    if (fromNested) {
      return fromNested;
    }
    if (typeof maybe.message === 'string' && maybe.message.trim()) {
      const msg = maybe.message.trim();
      if (!msg.toLowerCase().startsWith('http failure response')) {
        return msg;
      }
    }
    if (typeof maybe.status === 'number') {
      const statusMsg = statusFallback(maybe.status);
      if (statusMsg) {
        return statusMsg;
      }
    }
  }

  return fallback;
}

function statusFallback(status: number): string | null {
  switch (status) {
    case 0:
      return 'Sin conexión con el servidor POS. Compruebe red, VPN o que la API esté en ejecución.';
    case 400:
      return 'Solicitud inválida. Revise el archivo y el mapeo de columnas.';
    case 401:
      return 'Sesión expirada. Vuelva a iniciar sesión.';
    case 403:
      return 'No tiene permiso para importar (se requiere acceso de escritura al catálogo).';
    case 413:
      return 'El archivo es demasiado grande para subirlo.';
    case 500:
      return 'Error interno del servidor al procesar el archivo.';
    case 502:
    case 503:
    case 504:
      return 'El servidor POS no está disponible en este momento. Intente de nuevo en unos minutos.';
    default:
      return null;
  }
}

function extractMessageFromBody(body: unknown): string | null {
  if (typeof body === 'string' && body.trim()) {
    const trimmed = body.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return extractMessageFromBody(JSON.parse(trimmed) as unknown);
      } catch {
        return trimmed.length > 500 ? trimmed.slice(0, 500) + '…' : trimmed;
      }
    }
    return trimmed;
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

  const errors = o['errors'];
  if (Array.isArray(errors) && errors.length > 0) {
    const parts = errors
      .map((e) => {
        if (typeof e === 'string') {
          return e.trim();
        }
        if (e && typeof e === 'object') {
          const row = e as Record<string, unknown>;
          const field = pickNonEmptyString(row['field']);
          const msg = pickNonEmptyString(row['message']) ?? pickNonEmptyString(row['defaultMessage']);
          if (field && msg) {
            return `${field}: ${msg}`;
          }
          return msg ?? field;
        }
        return '';
      })
      .filter((s): s is string => !!s);
    if (parts.length) {
      return parts.join('; ');
    }
  }

  const title = pickNonEmptyString(o['title']);
  if (title && !GENERIC_HTTP_TITLES.has(title)) {
    return title;
  }

  const error = pickNonEmptyString(o['error']);
  if (error && !GENERIC_HTTP_TITLES.has(error)) {
    return error;
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
