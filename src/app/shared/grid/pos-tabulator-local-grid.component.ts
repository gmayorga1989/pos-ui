import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import type { ColumnDefinition, Options } from 'tabulator-tables';
import { resolvePosAssetUrl } from './resolve-pos-asset-url.util';
import {
  buildPosTabulatorPlaceholder,
  posTabulatorEmptyImageFor,
  type PosTabulatorEmptyContext,
  type PosTabulatorEmptyOptions,
} from './tabulator-empty.util';
import {
  POS_TABULATOR_LOCALE,
  posTabulatorLangs,
  posTabulatorPaginationCounter,
} from './pos-tabulator-locale.util';

/** Opciones Tabulator 6 no cubiertas del todo por @types (selectableRows, rowHeader). */
type TabulatorRowHeader = {
  formatter: string;
  titleFormatter?: string;
  headerSort?: boolean;
  resizable?: boolean;
  frozen?: boolean;
  headerHozAlign?: string;
  hozAlign?: string;
  width?: number;
};

type TabulatorGridOptions = Options & {
  selectableRows?: boolean;
  rowHeader?: TabulatorRowHeader;
};

@Component({
  selector: 'pos-tabulator-local-grid',
  standalone: true,
  template: `<div #host class="ts-tabulator-grid ts-tabulator-local-root"></div>`,
  styles: `
    :host {
      display: block;
    }
    .ts-tabulator-local-root {
      width: 100%;
    }
  `,
})
export class PosTabulatorLocalGridComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  @Input({ required: true }) data: Record<string, unknown>[] = [];
  @Input({ required: true }) columns: ColumnDefinition[] = [];
  @Input() height = 'min(620px, calc(100vh - 15.5rem))';
  @Input() pagination = false;
  @Input() paginationSize = 10;
  @Input() reloadNonce = 0;
  @Input() emptyContext: PosTabulatorEmptyContext = 'masters';
  @Input() emptyTitle = '';
  @Input() emptyDescription = '';
  @Input() emptyHighlight = 'Agregar';
  @Input() emptyCtaLabel = '';
  @Input() emptyCtaAction = 'create';
  @Input() emptyImagePath = '';
  @Input() rowSelection = false;

  @Output() rowAction = new EventEmitter<{ action: string; row: Record<string, unknown> }>();
  @Output() emptyAction = new EventEmitter<string>();

  private table: Tabulator | null = null;
  private lastDataInputSignature = '';
  private lastReloadNonceApplied: number | null = null;
  private activeMenu: HTMLElement | null = null;
  private activeToggle: HTMLElement | null = null;
  private activeMenuHome: HTMLElement | null = null;
  private activeRow: Record<string, unknown> | null = null;
  private readonly onDocumentClick = (event: MouseEvent) => this.handleDocumentClick(event);
  private readonly onHostClick = (event: MouseEvent) => this.handleEmptyActionClick(event);

  ngAfterViewInit(): void {
    this.buildTable();
    document.addEventListener('click', this.onDocumentClick);
    this.host.nativeElement.addEventListener('click', this.onHostClick);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.table) {
      return;
    }
    if (changes['data'] || changes['reloadNonce']) {
      const reloadCh = changes['reloadNonce'];
      const nonceForced =
        !!reloadCh && (reloadCh.firstChange || reloadCh.previousValue !== reloadCh.currentValue);
      const sig = JSON.stringify(this.data);
      const sameNonce = this.lastReloadNonceApplied !== null && this.reloadNonce === this.lastReloadNonceApplied;
      if (!nonceForced && sig === this.lastDataInputSignature && sameNonce) {
        return;
      }
      this.lastDataInputSignature = sig;
      this.lastReloadNonceApplied = this.reloadNonce;
      this.table.setData([...this.data]);
    }
    if (changes['columns'] && !changes['columns'].firstChange) {
      this.table.setColumns(this.normalizedColumns());
    }
    if (changes['rowSelection'] && !changes['rowSelection'].firstChange) {
      this.applyRowSelectionOptions();
    }
    if (changes['pagination'] || changes['paginationSize']) {
      this.applyPaginationOptions();
    }
    if (
      changes['emptyTitle'] ||
      changes['emptyDescription'] ||
      changes['emptyContext'] ||
      changes['emptyHighlight'] ||
      changes['emptyCtaLabel'] ||
      changes['emptyCtaAction'] ||
      changes['emptyImagePath']
    ) {
      this.applyPlaceholder();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.onDocumentClick);
    this.host.nativeElement.removeEventListener('click', this.onHostClick);
    this.closeActionMenus();
    this.table?.destroy();
    this.table = null;
  }

  private buildTable(): void {
    const opts = this.buildTableOptions();
    this.table = new Tabulator(this.host.nativeElement, opts);
    this.lastDataInputSignature = JSON.stringify(this.data);
    this.lastReloadNonceApplied = this.reloadNonce;
    this.table.on('cellClick', (e: unknown, cell: unknown) => {
      const ev = e as MouseEvent;
      const el = ev.target as HTMLElement | null;
      if (!el) {
        return;
      }
      const btn = el.closest<HTMLElement>('[data-ts-action]');
      const toggle = el.closest<HTMLElement>('.ts-grid-actions__toggle');
      if (toggle) {
        ev.preventDefault();
        ev.stopPropagation();
        const c = cell as { getRow: () => { getData: () => Record<string, unknown> } };
        const row = c.getRow().getData();
        const menu = toggle.parentElement?.querySelector<HTMLElement>('.dropdown-menu');
        const open = menu?.classList.contains('show') ?? false;
        this.closeActionMenus();
        if (!open) {
          this.openActionMenu(toggle, menu, row);
        }
        return;
      }
      if (!btn) {
        return;
      }
      const action = btn.getAttribute('data-ts-action');
      if (!action) {
        return;
      }
      const c = cell as { getRow: () => { getData: () => Record<string, unknown> } };
      this.rowAction.emit({ action, row: c.getRow().getData() });
    });
  }

  private buildPlaceholder(): string {
    const opts: PosTabulatorEmptyOptions = {
      highlight: this.emptyHighlight,
      ctaAction: this.emptyCtaAction,
      imageSrc: resolvePosAssetUrl(
        this.emptyImagePath.trim() || posTabulatorEmptyImageFor(this.emptyContext),
      ),
    };
    if (this.emptyTitle.trim()) {
      opts.title = this.emptyTitle;
    }
    if (this.emptyDescription.trim()) {
      opts.description = this.emptyDescription;
    }
    if (this.emptyCtaLabel.trim()) {
      opts.ctaLabel = this.emptyCtaLabel;
    }
    return buildPosTabulatorPlaceholder(this.emptyContext, opts);
  }

  private handleEmptyActionClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>('[data-pos-empty-action]');
    if (!btn) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.emptyAction.emit(btn.getAttribute('data-pos-empty-action') ?? 'create');
  }

  private applyPlaceholder(): void {
    if (!this.table) {
      return;
    }
    this.table.options.placeholder = this.buildPlaceholder();
    void this.table.redraw(true);
  }

  private applyPaginationOptions(): void {
    if (!this.table) {
      return;
    }
    this.table.options.locale = POS_TABULATOR_LOCALE;
    this.table.options.langs = posTabulatorLangs();
    this.table.options.pagination = this.pagination;
    this.table.options.paginationSize = this.paginationSize;
    this.table.options.paginationSizeSelector = this.pagination ? [10, 15, 20, 50] : undefined;
    this.table.options.paginationCounter = this.pagination ? posTabulatorPaginationCounter : undefined;
    void this.table.redraw(true);
  }

  private buildTableOptions(): TabulatorGridOptions {
    const opts: TabulatorGridOptions = {
      layout: 'fitColumns',
      height: this.height,
      locale: POS_TABULATOR_LOCALE,
      langs: posTabulatorLangs(),
      pagination: this.pagination,
      paginationSize: this.paginationSize,
      paginationSizeSelector: this.pagination ? [10, 15, 20, 50] : undefined,
      paginationCounter: this.pagination ? posTabulatorPaginationCounter : undefined,
      placeholder: this.buildPlaceholder(),
      data: [...this.data],
      columns: this.normalizedColumns(),
    };
    if (this.rowSelection) {
      opts.selectableRows = true;
      opts.rowHeader = this.buildRowHeader();
    }
    return opts;
  }

  private buildRowHeader(): TabulatorRowHeader {
    return {
      formatter: 'rowSelection',
      titleFormatter: 'rowSelection',
      headerSort: false,
      resizable: false,
      frozen: true,
      headerHozAlign: 'center',
      hozAlign: 'center',
      width: 42,
    };
  }

  private applyRowSelectionOptions(): void {
    if (!this.table) {
      return;
    }
    const opts = this.table.options as TabulatorGridOptions;
    if (this.rowSelection) {
      opts.selectableRows = true;
      opts.rowHeader = this.buildRowHeader();
    } else {
      opts.selectableRows = false;
      delete opts.rowHeader;
    }
    void this.table.redraw(true);
  }

  private normalizedColumns(): ColumnDefinition[] {
    return this.columns.map((col) => ({
      ...col,
      headerSort: col.headerSort === true,
      headerWordWrap: true,
    }));
  }

  private closeActionMenus(): void {
    if (this.activeMenu) {
      this.activeMenu.classList.remove('show');
      this.activeMenu.removeAttribute('style');
      if (this.activeMenuHome && this.activeMenu.parentElement !== this.activeMenuHome) {
        this.activeMenuHome.appendChild(this.activeMenu);
      }
    }
    this.activeToggle?.classList.remove('show');
    this.activeToggle?.setAttribute('aria-expanded', 'false');
    this.activeMenu = null;
    this.activeToggle = null;
    this.activeMenuHome = null;
    this.activeRow = null;
  }

  private openActionMenu(
    toggle: HTMLElement,
    menu: HTMLElement | null | undefined,
    row: Record<string, unknown>,
  ): void {
    if (!menu) {
      return;
    }
    this.activeMenu = menu;
    this.activeToggle = toggle;
    this.activeMenuHome = menu.parentElement;
    this.activeRow = row;
    document.body.appendChild(menu);
    this.positionMenu(toggle, menu);
    menu.classList.add('show');
    toggle.classList.add('show');
    toggle.setAttribute('aria-expanded', 'true');
  }

  private handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (this.activeMenu?.contains(target)) {
      const btn = target.closest<HTMLElement>('[data-ts-action]');
      const action = btn?.getAttribute('data-ts-action');
      if (action && this.activeRow) {
        event.preventDefault();
        this.rowAction.emit({ action, row: this.activeRow });
        this.closeActionMenus();
      }
      return;
    }
    if (this.activeToggle?.contains(target)) {
      return;
    }
    this.closeActionMenus();
  }

  private positionMenu(toggle: HTMLElement, menu: HTMLElement | null | undefined): void {
    if (!menu) {
      return;
    }
    const rect = toggle.getBoundingClientRect();
    const menuWidth = 174;
    const preferredLeft = rect.right + 8;
    const fallbackLeft = rect.left - menuWidth - 8;
    const left =
      preferredLeft + menuWidth <= window.innerWidth - 8 ? preferredLeft : Math.max(8, fallbackLeft);
    const top = Math.min(window.innerHeight - 8, rect.bottom + 8);
    menu.style.position = 'fixed';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.minWidth = `${menuWidth}px`;
  }
}
