import type { PosCustomerRequest } from '../../core/api/pos-backend.types';

export const CONSUMIDOR_FINAL_ID = '9999999999999';
export const CONSUMIDOR_FINAL_NAME = 'CONSUMIDOR FINAL';

export type PosTipoIdentificacion = '04' | '05' | '06' | '07';

export interface PosCustomerFormState {
  tipoIdentificacion: PosTipoIdentificacion;
  identificacion: string;
  razonSocial: string;
  nombreComercial: string;
  nombres: string;
  apellidos: string;
  direccion: string;
  phone: string;
  email: string;
  priceListId: string;
  active?: boolean | null;
}

export interface PosCustomerFormErrors {
  tipoIdentificacion?: string;
  identificacion?: string;
  razonSocial?: string;
  nombreComercial?: string;
  nombres?: string;
  apellidos?: string;
  direccion?: string;
  phone?: string;
  email?: string;
}

export function isRucTipo(tipo: string): boolean {
  return tipo === '04';
}

export function isPersonaNaturalTipo(tipo: string): boolean {
  return tipo === '05' || tipo === '06';
}

export function isConsumidorFinalTipo(tipo: string): boolean {
  return tipo === '07';
}

export function identificacionLabel(tipo: string): string {
  if (isRucTipo(tipo)) return 'RUC';
  if (tipo === '05') return 'Cédula';
  if (tipo === '06') return 'Pasaporte';
  return 'Identificación';
}

export function identificacionMaxLength(tipo: string): number {
  if (isRucTipo(tipo) || isConsumidorFinalTipo(tipo)) return 13;
  if (tipo === '05') return 10;
  return 20;
}

export function identificacionInputMode(tipo: string): 'numeric' | 'text' {
  return isRucTipo(tipo) || tipo === '05' || isConsumidorFinalTipo(tipo) ? 'numeric' : 'text';
}

export function direccionRequired(tipo: string): boolean {
  return isRucTipo(tipo) || tipo === '05';
}

export function applyTipoIdentificacionDefaults(form: PosCustomerFormState): void {
  if (isConsumidorFinalTipo(form.tipoIdentificacion)) {
    form.identificacion = CONSUMIDOR_FINAL_ID;
    if (!form.razonSocial.trim()) {
      form.razonSocial = CONSUMIDOR_FINAL_NAME;
    }
    form.nombres = '';
    form.apellidos = '';
    form.nombreComercial = '';
    return;
  }
  if (form.identificacion === CONSUMIDOR_FINAL_ID) {
    form.identificacion = '';
  }
  if (form.razonSocial === CONSUMIDOR_FINAL_NAME && isPersonaNaturalTipo(form.tipoIdentificacion)) {
    form.razonSocial = '';
  }
}

const NAME_PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'VON', 'VAN', 'MC', 'MAC', 'SAN', 'SANTA']);

function isNameParticle(token: string): boolean {
  return NAME_PARTICLES.has(token.toUpperCase());
}

/**
 * Agrupa palabras respetando partículas de apellido compuesto (p. ej. DE LA CRUZ).
 */
export function groupNombreCompletoUnits(fullName: string): string[] {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  const units: string[] = [];
  let i = 0;

  while (i < tokens.length) {
    const parts: string[] = [tokens[i]];
    i++;

    while (i < tokens.length) {
      const lastWord = parts[parts.length - 1].toUpperCase();
      const next = tokens[i].toUpperCase();

      if (isNameParticle(lastWord)) {
        parts.push(tokens[i]);
        i++;
        continue;
      }
      if (isNameParticle(next)) {
        parts.push(tokens[i]);
        i++;
        if (i < tokens.length) {
          parts.push(tokens[i]);
          i++;
        }
        continue;
      }
      break;
    }

    units.push(parts.join(' '));
  }

  return units;
}

/**
 * Separa el nombre completo del registro civil ecuatoriano:
 * apellido paterno + apellido materno + nombres (simples o compuestos).
 */
function apellidoCompuesto(unit: string): boolean {
  const words = unit.trim().split(/\s+/);
  return words.length > 1 || words.some((word) => isNameParticle(word));
}

export function splitNombreCompletoEcuador(fullName: string): { nombres: string; apellidos: string } {
  const units = groupNombreCompletoUnits(fullName);
  if (units.length === 0) {
    return { nombres: '', apellidos: '' };
  }
  if (units.length === 1) {
    return { nombres: '', apellidos: units[0] };
  }
  if (units.length === 2) {
    return { nombres: units[1], apellidos: units[0] };
  }
  if (units.length === 3) {
    if (apellidoCompuesto(units[0])) {
      return { apellidos: units[0], nombres: `${units[1]} ${units[2]}`.trim() };
    }
    return { apellidos: `${units[0]} ${units[1]}`.trim(), nombres: units[2] };
  }

  return {
    apellidos: `${units[0]} ${units[1]}`.trim(),
    nombres: units.slice(2).join(' '),
  };
}

/** Alias histórico: asume orden registro civil (apellidos antes que nombres). */
export function splitRazonSocialPersona(razonSocial: string): { nombres: string; apellidos: string } {
  return splitNombreCompletoEcuador(razonSocial);
}

export function buildRazonSocialFromForm(form: PosCustomerFormState): string {
  if (isPersonaNaturalTipo(form.tipoIdentificacion)) {
    return `${form.apellidos.trim()} ${form.nombres.trim()}`.trim();
  }
  return form.razonSocial.trim();
}

export function buildCustomerRequest(form: PosCustomerFormState): PosCustomerRequest {
  return {
    tipoIdentificacion: form.tipoIdentificacion,
    identificacion: form.identificacion.trim(),
    razonSocial: buildRazonSocialFromForm(form),
    nombreComercial: form.nombreComercial.trim() || null,
    direccion: form.direccion.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    priceListId: form.priceListId.trim() || null,
    active: form.active ?? true,
  };
}

function cedulaEcuadorValida(cedula: string): boolean {
  const provincia = Number(cedula.slice(0, 2));
  if (provincia < 1 || provincia > 24) return false;
  const tercerDigito = Number(cedula.charAt(2));
  if (tercerDigito > 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let valor = Number(cedula.charAt(i)) * coef[i];
    if (valor >= 10) valor -= 9;
    suma += valor;
  }
  const digito = (10 - (suma % 10)) % 10;
  return digito === Number(cedula.charAt(9));
}

export function validateCustomerForm(form: PosCustomerFormState): PosCustomerFormErrors {
  const errors: PosCustomerFormErrors = {};
  const tipo = form.tipoIdentificacion;
  const identificacion = form.identificacion.trim();

  if (!tipo) {
    errors.tipoIdentificacion = 'Seleccione el tipo de identificación';
  }

  if (isConsumidorFinalTipo(tipo)) {
    if (identificacion !== CONSUMIDOR_FINAL_ID) {
      errors.identificacion = `Debe ser ${CONSUMIDOR_FINAL_ID}`;
    }
    if (!form.razonSocial.trim()) {
      errors.razonSocial = 'Ingrese el nombre del consumidor final';
    }
  } else if (isRucTipo(tipo)) {
    if (!/^\d{13}$/.test(identificacion)) {
      errors.identificacion = 'El RUC debe tener 13 dígitos';
    }
    if (!form.razonSocial.trim()) {
      errors.razonSocial = 'Ingrese la razón social';
    }
  } else if (tipo === '05') {
    if (!/^\d{10}$/.test(identificacion)) {
      errors.identificacion = 'La cédula debe tener 10 dígitos';
    } else if (!cedulaEcuadorValida(identificacion)) {
      errors.identificacion = 'La cédula no es válida';
    }
    if (!form.nombres.trim()) {
      errors.nombres = 'Ingrese los nombres';
    }
    if (!form.apellidos.trim()) {
      errors.apellidos = 'Ingrese los apellidos';
    }
  } else if (tipo === '06') {
    if (identificacion.length < 3 || identificacion.length > 20) {
      errors.identificacion = 'El pasaporte debe tener entre 3 y 20 caracteres';
    }
    if (!form.nombres.trim()) {
      errors.nombres = 'Ingrese los nombres';
    }
    if (!form.apellidos.trim()) {
      errors.apellidos = 'Ingrese los apellidos';
    }
  }

  if (direccionRequired(tipo) && !form.direccion.trim()) {
    errors.direccion = 'La dirección es obligatoria';
  }

  const phone = form.phone.trim();
  if (phone && !/^[0-9+\-() ]{7,20}$/.test(phone)) {
    errors.phone = 'Teléfono inválido';
  }

  const email = form.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Correo electrónico inválido';
  }

  return errors;
}

export function hasCustomerFormErrors(errors: PosCustomerFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function emptyCustomerForm(tipo: PosTipoIdentificacion = '05'): PosCustomerFormState {
  const form: PosCustomerFormState = {
    tipoIdentificacion: tipo,
    identificacion: '',
    razonSocial: '',
    nombreComercial: '',
    nombres: '',
    apellidos: '',
    direccion: '',
    phone: '',
    email: '',
    priceListId: '',
    active: true,
  };
  applyTipoIdentificacionDefaults(form);
  return form;
}

export function customerFormFromResponse(c: {
  tipoIdentificacion: string;
  identificacion: string;
  razonSocial: string;
  nombreComercial?: string | null;
  direccion?: string | null;
  phone?: string | null;
  email?: string | null;
  priceListId?: string | null;
  active?: boolean;
}): PosCustomerFormState {
  const tipo = (c.tipoIdentificacion || '05') as PosTipoIdentificacion;
  const form: PosCustomerFormState = {
    tipoIdentificacion: tipo,
    identificacion: c.identificacion ?? '',
    razonSocial: c.razonSocial ?? '',
    nombreComercial: c.nombreComercial ?? '',
    nombres: '',
    apellidos: '',
    direccion: c.direccion ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    priceListId: c.priceListId ?? '',
    active: c.active ?? true,
  };
  if (isPersonaNaturalTipo(tipo)) {
    const split = splitRazonSocialPersona(c.razonSocial ?? '');
    form.nombres = split.nombres;
    form.apellidos = split.apellidos;
    form.razonSocial = '';
  }
  return form;
}
