/**
 * Tabulator no publica tipos oficiales en el paquete npm; este shim evita `implicit any`
 * en imports ESM (`tabulator-tables`).
 */
declare module 'tabulator-tables' {
  export class TabulatorFull {
    constructor(element: HTMLElement, options: Options);
    options: Options;
    destroy(): void;
    setPage(page: number): Promise<boolean>;
    setColumns(columns: ColumnDefinition[]): void;
    setData(data: unknown[]): void;
    getData(): unknown[];
    redraw(force?: boolean): void;
    on(
      event: 'cellClick' | 'cellEdited' | 'rowDeleted',
      callback: (...args: unknown[]) => void,
    ): void;
  }

  export interface Options {
    layout?: string;
    height?: string;
    editable?: boolean;
    pagination?: boolean;
    paginationMode?: string;
    paginationSize?: number;
    paginationSizeSelector?: number[];
    paginationCounter?:
      | string
      | ((pageSize: number, currentRow: number, currentPage: number, totalRows: number, totalPages: number) => string);
    locale?: string;
    langs?: Record<string, Record<string, unknown>>;
    placeholder?: string;
    ajaxURL?: string;
    ajaxRequestFunc?: (url: string, config: unknown, params: Record<string, unknown>) => Promise<unknown>;
    data?: unknown[];
    columns?: ColumnDefinition[];
  }

  export interface ColumnDefinition {
    title?: string;
    field?: string;
    width?: number | string;
    widthGrow?: number;
    minWidth?: number;
    hozAlign?: 'left' | 'center' | 'right';
    headerSort?: boolean;
    headerWordWrap?: boolean;
    formatter?: string | ((cell: unknown) => string);
    editor?: string | false;
    editorParams?: unknown;
    editable?: boolean | ((cell: unknown) => boolean);
  }
}
