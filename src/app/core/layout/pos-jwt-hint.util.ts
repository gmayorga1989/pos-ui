/** Lectura no criptográfica del JWT solo para sugerencias de UI (densidad / perfil). */

export type PosDensityHint = 'compact' | 'comfortable' | 'touch';

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rolesList(payload: Record<string, unknown>): string[] {
  const raw = payload['roles'];
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Heurística simple alineada con roles típicos del Identity / Suite. */
export function suggestDensityFromJwt(accessToken: string | null): PosDensityHint | null {
  if (!accessToken) {
    return null;
  }
  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return null;
  }
  const roles = rolesList(payload);
  if (
    roles.some((r) =>
      ['CAJERO', 'VENDEDOR', 'MOSTRADOR', 'POS_CAJERO'].includes(r),
    )
  ) {
    return 'touch';
  }
  if (roles.some((r) => ['SUPERVISOR', 'SUITE_ADMIN', 'ADMIN'].includes(r))) {
    return 'compact';
  }
  return 'comfortable';
}

export interface PosSessionDisplay {
  cashierEmail: string;
  cashierLabel: string;
  cashierName: string;
  companySlug: string;
  companyId: string;
  companyName: string;
}

function firstString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function readPosSessionDisplay(accessToken: string | null): PosSessionDisplay {
  const empty: PosSessionDisplay = {
    cashierEmail: '',
    cashierLabel: '—',
    cashierName: '',
    companySlug: '',
    companyId: '',
    companyName: '',
  };
  if (!accessToken) {
    return empty;
  }
  const p = decodeJwtPayload(accessToken);
  if (!p) {
    return empty;
  }
  const email = firstString(p, ['email', 'userEmail', 'user_email', 'preferred_username']);
  const userName = firstString(p, [
    'name',
    'full_name',
    'fullName',
    'userName',
    'username',
    'usuario',
    'nombreUsuario',
    'cashierName',
    'cashier_name',
  ]);
  const companyName = firstString(p, [
    'companyName',
    'company_name',
    'companyLegalName',
    'company_legal_name',
    'businessName',
    'business_name',
    'razonSocial',
    'razon_social',
    'razonSocialEmpresa',
    'nombreEmpresa',
    'tenantName',
    'tenant_name',
  ]);
  const slug = firstString(p, ['companySlug', 'company_slug']);
  const cidRaw = p['company_id'];
  const companyId = cidRaw != null ? String(cidRaw) : '';
  let label = '—';
  if (userName) {
    label = userName;
  } else if (email) {
    const at = email.indexOf('@');
    label = at > 0 ? email.slice(0, at) : email;
  }
  return {
    cashierEmail: email,
    cashierLabel: label,
    cashierName: userName,
    companySlug: slug,
    companyId,
    companyName,
  };
}
