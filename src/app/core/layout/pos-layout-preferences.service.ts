import { Injectable, inject, signal } from '@angular/core';
import { PosAuthService } from '../auth/pos-auth.service';
import { PosDensityHint, suggestDensityFromJwt } from './pos-jwt-hint.util';

export type PosTheme = 'light' | 'dark';
export type PosDensity = PosDensityHint;
export type PosDensitySource = 'auto' | 'manual';
export type PosRoleProfile = 'auto' | 'cajero' | 'supervisor' | 'mostrador';
export type PosHandedness = 'right' | 'left';
export type PosCardProvider = 'datafast' | 'kushki' | 'nuvei' | 'placetopay' | 'payphone' | 'manual';

const K_THEME = 'lux_ui_theme';
const K_THEME_LEGACY = 'pos_ui_theme';
const K_DENSITY = 'pos_ui_density';
const K_DENSITY_SRC = 'pos_ui_density_src';
const K_ROLE = 'pos_ui_role_profile';
const K_HANDEDNESS = 'pos_ui_handedness';
const K_CAJA = 'pos_ui_caja_id';
const K_PUNTO_EMISION = 'pos_ui_punto_emision_id';
const K_LOCAL_BRANCH_CODE = 'pos_ui_local_branch_code';
const K_LOCAL_EMISSION_CODE = 'pos_ui_local_emission_code';
const K_SOUND = 'pos_ui_sound';
const K_SEPARATE_SAME_PRODUCT = 'pos_ui_separate_same_product';
const K_UPSELL = 'pos_ui_upsell';
const K_SHOW_IMG = 'pos_ui_show_product_images';
const K_MANUAL_PRICE_LIST = 'pos_ui_manual_price_list';
const K_RECEIPT_PRINTER = 'pos_ui_receipt_printer';
const K_LABEL_PRINTER = 'pos_ui_label_printer';
const K_LABEL_FORMAT = 'pos_ui_label_format';
const K_AUTO_RECEIPT = 'pos_ui_auto_receipt';
const K_OPEN_DRAWER = 'pos_ui_open_drawer';
const K_SCAN_AUTO_ADD = 'pos_ui_scan_auto_add';
const K_RECEIPT_TEMPLATE = 'pos_ui_receipt_template';
const K_DEFAULT_DOC = 'pos_ui_default_doc';
const K_DISCOUNT_LIMIT = 'pos_ui_discount_limit';
const K_MIN_INVOICE = 'pos_ui_min_invoice';
const K_REQUIRE_CUSTOMER_OVER = 'pos_ui_require_customer_over';
const K_CARD_PROVIDER = 'pos_ui_card_provider';
const K_CARD_TERMINAL_ID = 'pos_ui_card_terminal_id';
const K_CARD_LINK_MODE = 'pos_ui_card_link_mode';

@Injectable({ providedIn: 'root' })
export class PosLayoutPreferencesService {
  private readonly auth = inject(PosAuthService);

  readonly theme = signal<PosTheme>('light');
  readonly densitySource = signal<PosDensitySource>('auto');
  readonly densityManual = signal<PosDensity>('comfortable');
  readonly roleProfile = signal<PosRoleProfile>('auto');
  readonly handedness = signal<PosHandedness>('right');
  readonly cajaId = signal<string>('');
  /** UUID del punto de emisión en eFactura (emisión desde POS). */
  readonly puntoEmisionId = signal<string>('');
  readonly localBranchCode = signal('001');
  readonly localEmissionCode = signal('001');
  readonly soundOn = signal(true);
  readonly separateSameProductLines = signal(false);
  readonly upsellOn = signal(false);
  /** Miniatura de producto en cartillas del catálogo. */
  readonly showProductImages = signal(true);
  /** Permite al cajero cambiar la lista de precio en venta (si está desactivado, se usa la del cliente). */
  readonly allowManualPriceListSelection = signal(true);
  readonly receiptPrinter = signal('');
  readonly labelPrinter = signal('');
  readonly labelFormat = signal('58x40');
  readonly autoReceipt = signal(false);
  readonly openDrawerAfterCash = signal(true);
  readonly scanAutoAdd = signal(true);
  readonly receiptTemplate = signal('ticket-58');
  readonly defaultDocumentType = signal('nota-venta');
  readonly maxDiscountPercent = signal('10');
  readonly minInvoiceAmount = signal('0');
  readonly requireCustomerOver = signal('50');
  readonly cardProvider = signal<PosCardProvider>('datafast');
  readonly cardTerminalId = signal('');
  readonly cardLinkMode = signal('qr-link');
  /** Incrementa para forzar actualización de UI dependiente de preferencias (p. ej. chip en shell). */
  readonly layoutTick = signal(0);

  /** Densidad efectiva: manual, o automática según perfil + JWT. */
  resolveEffectiveDensity(): PosDensity {
    if (this.densitySource() === 'manual') {
      return this.densityManual();
    }
    const at = this.auth.accessToken();
    const fromJwt = suggestDensityFromJwt(at);
    const prof = this.roleProfile();
    if (prof === 'cajero') {
      return 'touch';
    }
    if (prof === 'supervisor') {
      return 'compact';
    }
    if (prof === 'mostrador') {
      return 'comfortable';
    }
    return fromJwt ?? 'comfortable';
  }

  constructor() {
    this.hydrateFromStorage();
    this.applyDocumentAttributes();
  }

  hydrateFromStorage(): void {
    let t = localStorage.getItem(K_THEME) as PosTheme | null;
    if (t !== 'light' && t !== 'dark') {
      t = localStorage.getItem(K_THEME_LEGACY) as PosTheme | null;
    }
    if (t === 'light' || t === 'dark') {
      this.theme.set(t);
    }
    const ds = localStorage.getItem(K_DENSITY_SRC) as PosDensitySource | null;
    if (ds === 'auto' || ds === 'manual') {
      this.densitySource.set(ds);
    }
    const d = localStorage.getItem(K_DENSITY) as PosDensity | null;
    if (d === 'compact' || d === 'comfortable' || d === 'touch') {
      this.densityManual.set(d);
    }
    const rp = localStorage.getItem(K_ROLE) as PosRoleProfile | null;
    if (rp === 'auto' || rp === 'cajero' || rp === 'supervisor' || rp === 'mostrador') {
      this.roleProfile.set(rp);
    }
    const hand = localStorage.getItem(K_HANDEDNESS) as PosHandedness | null;
    if (hand === 'right' || hand === 'left') {
      this.handedness.set(hand);
    }
    const caja = localStorage.getItem(K_CAJA);
    if (caja) {
      this.cajaId.set(caja.trim());
    }
    const pe = localStorage.getItem(K_PUNTO_EMISION);
    if (pe) {
      this.puntoEmisionId.set(pe.trim());
    }
    this.localBranchCode.set(localStorage.getItem(K_LOCAL_BRANCH_CODE)?.trim() || '001');
    this.localEmissionCode.set(localStorage.getItem(K_LOCAL_EMISSION_CODE)?.trim() || '001');
    if (localStorage.getItem(K_SOUND) === '0') {
      this.soundOn.set(false);
    }
    if (localStorage.getItem(K_SEPARATE_SAME_PRODUCT) === '1') {
      this.separateSameProductLines.set(true);
    }
    if (localStorage.getItem(K_UPSELL) === '1') {
      this.upsellOn.set(true);
    }
    if (localStorage.getItem(K_SHOW_IMG) === '0') {
      this.showProductImages.set(false);
    }
    if (localStorage.getItem(K_MANUAL_PRICE_LIST) === '0') {
      this.allowManualPriceListSelection.set(false);
    }
    this.receiptPrinter.set(localStorage.getItem(K_RECEIPT_PRINTER)?.trim() ?? '');
    this.labelPrinter.set(localStorage.getItem(K_LABEL_PRINTER)?.trim() ?? '');
    this.labelFormat.set(localStorage.getItem(K_LABEL_FORMAT)?.trim() || '58x40');
    this.receiptTemplate.set(localStorage.getItem(K_RECEIPT_TEMPLATE)?.trim() || 'ticket-58');
    this.defaultDocumentType.set(localStorage.getItem(K_DEFAULT_DOC)?.trim() || 'nota-venta');
    this.maxDiscountPercent.set(localStorage.getItem(K_DISCOUNT_LIMIT)?.trim() || '10');
    this.minInvoiceAmount.set(localStorage.getItem(K_MIN_INVOICE)?.trim() || '0');
    this.requireCustomerOver.set(localStorage.getItem(K_REQUIRE_CUSTOMER_OVER)?.trim() || '50');
    const cp = localStorage.getItem(K_CARD_PROVIDER) as PosCardProvider | null;
    if (cp && ['datafast', 'kushki', 'nuvei', 'placetopay', 'payphone', 'manual'].includes(cp)) {
      this.cardProvider.set(cp);
    }
    this.cardTerminalId.set(localStorage.getItem(K_CARD_TERMINAL_ID)?.trim() ?? '');
    this.cardLinkMode.set(localStorage.getItem(K_CARD_LINK_MODE)?.trim() || 'qr-link');
    if (localStorage.getItem(K_AUTO_RECEIPT) === '1') {
      this.autoReceipt.set(true);
    }
    if (localStorage.getItem(K_OPEN_DRAWER) === '0') {
      this.openDrawerAfterCash.set(false);
    }
    if (localStorage.getItem(K_SCAN_AUTO_ADD) === '0') {
      this.scanAutoAdd.set(false);
    }
  }

  applyDocumentAttributes(): void {
    const root = document.documentElement;
    const theme = this.theme();
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-lux-theme', theme);
    root.setAttribute('data-bs-theme', theme);
    root.setAttribute('data-density', this.resolveEffectiveDensity());
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  }

  /** Llamar tras login / cambio de token o preferencias. */
  bumpDocumentDensity(): void {
    document.documentElement.setAttribute('data-density', this.resolveEffectiveDensity());
    this.layoutTick.update((n) => n + 1);
  }

  setTheme(value: PosTheme): void {
    this.theme.set(value);
    localStorage.setItem(K_THEME, value);
    localStorage.setItem(K_THEME_LEGACY, value);
    this.applyDocumentAttributes();
    this.layoutTick.update((n) => n + 1);
  }

  toggleTheme(): void {
    this.setTheme(this.theme() === 'light' ? 'dark' : 'light');
  }

  setDensitySource(src: PosDensitySource): void {
    this.densitySource.set(src);
    localStorage.setItem(K_DENSITY_SRC, src);
    this.bumpDocumentDensity();
  }

  setDensityManual(value: PosDensity): void {
    this.densityManual.set(value);
    localStorage.setItem(K_DENSITY, value);
    this.bumpDocumentDensity();
  }

  setRoleProfile(value: PosRoleProfile): void {
    this.roleProfile.set(value);
    localStorage.setItem(K_ROLE, value);
    this.bumpDocumentDensity();
  }

  setHandedness(value: PosHandedness): void {
    this.handedness.set(value);
    localStorage.setItem(K_HANDEDNESS, value);
    this.layoutTick.update((n) => n + 1);
  }

  setCajaId(value: string): void {
    const v = value.trim();
    this.cajaId.set(v);
    if (v) {
      localStorage.setItem(K_CAJA, v);
    } else {
      localStorage.removeItem(K_CAJA);
    }
    this.layoutTick.update((n) => n + 1);
  }

  setPuntoEmisionId(value: string): void {
    const v = value.trim();
    this.puntoEmisionId.set(v);
    if (v) {
      localStorage.setItem(K_PUNTO_EMISION, v);
    } else {
      localStorage.removeItem(K_PUNTO_EMISION);
    }
    this.layoutTick.update((n) => n + 1);
  }

  setLocalBranchCode(value: string): void {
    this.setText(this.localBranchCode, K_LOCAL_BRANCH_CODE, value || '001');
  }

  setLocalEmissionCode(value: string): void {
    this.setText(this.localEmissionCode, K_LOCAL_EMISSION_CODE, value || '001');
  }

  localPuntoEmisionId(): string {
    const branch = this.localBranchCode().trim() || '001';
    const emission = this.localEmissionCode().trim() || '001';
    return `LOCAL-${branch}-${emission}`;
  }

  setSound(on: boolean): void {
    this.soundOn.set(on);
    localStorage.setItem(K_SOUND, on ? '1' : '0');
  }

  setSeparateSameProductLines(on: boolean): void {
    this.separateSameProductLines.set(on);
    localStorage.setItem(K_SEPARATE_SAME_PRODUCT, on ? '1' : '0');
  }

  setUpsell(on: boolean): void {
    this.upsellOn.set(on);
    localStorage.setItem(K_UPSELL, on ? '1' : '0');
  }

  setShowProductImages(on: boolean): void {
    this.showProductImages.set(on);
    localStorage.setItem(K_SHOW_IMG, on ? '1' : '0');
    this.layoutTick.update((n) => n + 1);
  }

  setAllowManualPriceListSelection(on: boolean): void {
    this.allowManualPriceListSelection.set(on);
    localStorage.setItem(K_MANUAL_PRICE_LIST, on ? '1' : '0');
    this.layoutTick.update((n) => n + 1);
  }

  setReceiptPrinter(value: string): void {
    this.setText(this.receiptPrinter, K_RECEIPT_PRINTER, value);
  }

  setLabelPrinter(value: string): void {
    this.setText(this.labelPrinter, K_LABEL_PRINTER, value);
  }

  setLabelFormat(value: string): void {
    this.setText(this.labelFormat, K_LABEL_FORMAT, value);
  }

  setAutoReceipt(on: boolean): void {
    this.autoReceipt.set(on);
    localStorage.setItem(K_AUTO_RECEIPT, on ? '1' : '0');
  }

  setOpenDrawerAfterCash(on: boolean): void {
    this.openDrawerAfterCash.set(on);
    localStorage.setItem(K_OPEN_DRAWER, on ? '1' : '0');
  }

  setScanAutoAdd(on: boolean): void {
    this.scanAutoAdd.set(on);
    localStorage.setItem(K_SCAN_AUTO_ADD, on ? '1' : '0');
  }

  setReceiptTemplate(value: string): void {
    this.setText(this.receiptTemplate, K_RECEIPT_TEMPLATE, value);
  }

  setDefaultDocumentType(value: string): void {
    this.setText(this.defaultDocumentType, K_DEFAULT_DOC, value);
  }

  setMaxDiscountPercent(value: string): void {
    this.setText(this.maxDiscountPercent, K_DISCOUNT_LIMIT, value);
  }

  setMinInvoiceAmount(value: string): void {
    this.setText(this.minInvoiceAmount, K_MIN_INVOICE, value);
  }

  setRequireCustomerOver(value: string): void {
    this.setText(this.requireCustomerOver, K_REQUIRE_CUSTOMER_OVER, value);
  }

  setCardProvider(value: PosCardProvider): void {
    this.cardProvider.set(value);
    localStorage.setItem(K_CARD_PROVIDER, value);
    this.layoutTick.update((n) => n + 1);
  }

  setCardTerminalId(value: string): void {
    this.setText(this.cardTerminalId, K_CARD_TERMINAL_ID, value);
  }

  setCardLinkMode(value: string): void {
    this.setText(this.cardLinkMode, K_CARD_LINK_MODE, value);
  }

  private setText(target: { set(value: string): void }, key: string, value: string): void {
    const v = value.trim();
    target.set(v);
    if (v) {
      localStorage.setItem(key, v);
    } else {
      localStorage.removeItem(key);
    }
    this.layoutTick.update((n) => n + 1);
  }
}
