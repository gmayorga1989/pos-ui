/** Locale Tabulator para grids POS (español Ecuador). */
export const POS_TABULATOR_LOCALE = 'es-ec';

export function posTabulatorLangs(): Record<string, Record<string, unknown>> {
  return {
    [POS_TABULATOR_LOCALE]: {
      pagination: {
        page_size: 'Por página',
        page_title: 'Registros por página',
        first: 'Primera',
        first_title: 'Ir a la primera página',
        last: 'Última',
        last_title: 'Ir a la última página',
        prev: 'Anterior',
        prev_title: 'Página anterior',
        next: 'Siguiente',
        next_title: 'Página siguiente',
        all: 'Todos',
        counter: {
          showing: 'Mostrando',
          of: 'de',
          rows: 'registros',
          pages: 'páginas',
        },
      },
    },
  };
}

export function posTabulatorPaginationCounter(
  pageSize: number,
  currentRow: number,
  _currentPage: number,
  totalRows: number,
): string {
  if (totalRows <= 0) {
    return 'Sin registros';
  }
  const from = Math.max(1, currentRow);
  const to = Math.min(currentRow + pageSize - 1, totalRows);
  return `Mostrando ${from}–${to} de ${totalRows} registros`;
}
