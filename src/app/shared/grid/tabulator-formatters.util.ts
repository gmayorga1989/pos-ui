export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tabulatorTextareaCell(value: unknown): string {
  return `<span class="ts-cell-textarea">${escapeHtml(String(value ?? ''))}</span>`;
}

export function tabulatorCellValue(cell: unknown): unknown {
  return (cell as { getValue: () => unknown }).getValue();
}
