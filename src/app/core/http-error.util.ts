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

/** Mensaje legible para fallos de cobro PayPhone (pos-app → PayPhone). */
export function formatPayPhoneApiError(
  err: unknown,
  fallback = 'No se pudo procesar el cobro PayPhone',
): string {
  const raw = extractApiErrorMessage(err, '');
  if (!raw) {
    if (err instanceof HttpErrorResponse) {
      return `PayPhone: error HTTP ${err.status}`;
    }
    return fallback;
  }
  return enrichPayPhoneDetail(raw, err instanceof HttpErrorResponse ? err.status : null);
}

function enrichPayPhoneDetail(detail: string, httpStatus: number | null): string {
  const gatewayMatch = detail.match(/^PayPhone rechaz[oó] la solicitud \(HTTP (\d+)\):\s*(.*)$/is);
  if (gatewayMatch) {
    const providerCode = gatewayMatch[1];
    const providerBody = gatewayMatch[2]?.trim() ?? '';
    const providerMsg = parsePayPhoneProviderPayload(providerBody);
    const validationDetails = parsePayPhoneValidationErrors(providerBody);
    const parts = [`PayPhone respondió con error HTTP ${providerCode}.`];
    if (validationDetails) {
      parts.push(validationDetails);
    } else if (providerMsg) {
      parts.push(providerMsg);
    } else if (providerBody) {
      parts.push(truncateErrorText(providerBody, 420));
    }
    return parts.join(' ');
  }

  if (/^No se pudo llamar a PayPhone$/i.test(detail.trim())) {
    const suffix = httpStatus ? ` (HTTP ${httpStatus})` : '';
    return `No se pudo conectar con PayPhone${suffix}. Verifique token, URL base y que el servidor POS tenga salida a internet.`;
  }

  return truncateErrorText(detail, 640);
}

function parsePayPhoneValidationErrors(raw: string): string | null {
  if (!raw) {
    return null;
  }
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const errors = body['errors'];
    if (!Array.isArray(errors) || errors.length === 0) {
      return null;
    }
    const parts = errors
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }
        const row = entry as Record<string, unknown>;
        const field = pickNonEmptyString(row['message']);
        const descriptions = row['errorDescriptions'];
        const desc =
          Array.isArray(descriptions) && descriptions.length
            ? descriptions.map((d) => String(d).trim()).filter(Boolean).join('; ')
            : '';
        if (field && desc) {
          return `${field}: ${desc}`;
        }
        return desc || field || '';
      })
      .filter((part): part is string => !!part);
    return parts.length ? parts.join(' · ') : null;
  } catch {
    return null;
  }
}

function parsePayPhoneProviderPayload(raw: string): string | null {
  if (!raw) {
    return null;
  }
  try {
    return extractProviderMessage(JSON.parse(raw) as unknown);
  } catch {
    return raw.length <= 420 ? raw.trim() : null;
  }
}

function extractProviderMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'errorMessage', 'error', 'description', 'detail', 'Message', 'Error', 'title']) {
    const msg = pickNonEmptyString(record[key]);
    if (msg) {
      return msg;
    }
  }
  const errors = record['errors'];
  if (Array.isArray(errors) && errors.length > 0) {
    const parts = errors
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (entry && typeof entry === 'object') {
          const row = entry as Record<string, unknown>;
          return pickNonEmptyString(row['message']) ?? pickNonEmptyString(row['description']);
        }
        return '';
      })
      .filter((part): part is string => !!part);
    if (parts.length) {
      return parts.join('; ');
    }
  }
  return null;
}

function truncateErrorText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}
