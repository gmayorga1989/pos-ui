export interface PayPhoneCountryOption {
  code: string;
  label: string;
}

/** Países con cobertura PayPhone (código telefónico internacional sin +). */
export const PAYPHONE_COUNTRY_OPTIONS: PayPhoneCountryOption[] = [
  { code: '593', label: 'Ecuador (+593)' },
  { code: '57', label: 'Colombia (+57)' },
  { code: '51', label: 'Perú (+51)' },
  { code: '52', label: 'México (+52)' },
  { code: '56', label: 'Chile (+56)' },
  { code: '54', label: 'Argentina (+54)' },
  { code: '58', label: 'Venezuela (+58)' },
  { code: '507', label: 'Panamá (+507)' },
  { code: '506', label: 'Costa Rica (+506)' },
  { code: '503', label: 'El Salvador (+503)' },
  { code: '502', label: 'Guatemala (+502)' },
  { code: '504', label: 'Honduras (+504)' },
  { code: '505', label: 'Nicaragua (+505)' },
  { code: '1', label: 'Estados Unidos / Canadá (+1)' },
];

export function payPhoneCountryLabel(code: string | null | undefined): string {
  const normalized = (code ?? '').replace(/\D/g, '');
  if (!normalized) {
    return '—';
  }
  const match = PAYPHONE_COUNTRY_OPTIONS.find((opt) => opt.code === normalized);
  return match?.label ?? `+${normalized}`;
}

export function normalizePayPhoneCountryCode(code: string | null | undefined, fallback = '593'): string {
  const digits = (code ?? '').replace(/\D/g, '');
  return digits || fallback.replace(/\D/g, '') || '593';
}

export function normalizePayPhoneLocalPhone(phone: string | null | undefined): string {
  if (!phone?.trim()) {
    return '';
  }
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('593') && digits.length > 9) {
    digits = digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length > 9) {
    digits = digits.slice(1);
  }
  return digits;
}
