export type GridActionIcon =
  | 'view'
  | 'edit'
  | 'activate'
  | 'inactivate'
  | 'delete'
  | 'resend'
  | 'cancel'
  | 'pdf'
  | 'xml'
  | 'goal';

export interface GridActionItem {
  action: string;
  label: string;
  icon: GridActionIcon;
  danger?: boolean;
}

export function escapeGridHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Acciones inline estilo catálogo: ver, editar y menú adicional. */
export function gridCatalogIconActions(extraActions: GridActionItem[] = []): string {
  const menu =
    extraActions.length > 0
      ? gridActionsMenu(extraActions, 'Más acciones').replace(
          'class="ts-grid-actions dropdown"',
          'class="ts-grid-actions dropdown pos-catalog-row-actions__menu"',
        )
      : '';
  return `
    <div class="pos-catalog-row-actions">
      <button type="button" class="pos-catalog-row-actions__btn" data-ts-action="view" aria-label="Ver producto" title="Ver">
        ${gridActionIcon('view')}
      </button>
      <button type="button" class="pos-catalog-row-actions__btn" data-ts-action="edit" aria-label="Editar producto" title="Editar">
        ${gridActionIcon('edit')}
      </button>
      ${menu}
    </div>`;
}

export function gridActionsMenu(actions: GridActionItem[], ariaLabel = 'Acciones'): string {
  const items = actions
    .map(
      (item) => `
        <button type="button" class="dropdown-item ts-grid-actions__item${item.danger ? ' text-danger' : ''}" data-ts-action="${escapeGridHtml(item.action)}">
          ${gridActionIcon(item.icon)}
          <span>${escapeGridHtml(item.label)}</span>
        </button>`,
    )
    .join('');
  return `
    <div class="ts-grid-actions dropdown">
      <button type="button" class="ts-grid-actions__toggle" aria-label="${escapeGridHtml(ariaLabel)}" aria-expanded="false">
        <svg class="ts-grid-actions__dots" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" fill="currentColor"></circle>
          <circle cx="12" cy="12" r="1.8" fill="currentColor"></circle>
          <circle cx="12" cy="19" r="1.8" fill="currentColor"></circle>
        </svg>
      </button>
      <div class="dropdown-menu ts-grid-actions__menu">
        ${items}
      </div>
    </div>`;
}

function gridActionIcon(kind: GridActionIcon): string {
  const icons: Record<GridActionIcon, string> = {
    view: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21C16.97 21 21 12 21 12C21 12 16.97 3 12 3C7.03 3 3 12 3 12C3 12 7.03 21 12 21Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20H8L18.5 9.5C19.6 8.4 19.6 6.6 18.5 5.5C17.4 4.4 15.6 4.4 14.5 5.5L4 16V20Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5L17.5 10.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    activate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21Z" stroke="currentColor" stroke-width="1.8"/><path d="M8 12.3L10.6 14.9L16.2 9.3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    inactivate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21Z" stroke="currentColor" stroke-width="1.8"/><path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    delete: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 11V17M14 11V17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 7L8.6 19C8.66 20.1 9.57 21 10.68 21H13.32C14.43 21 15.34 20.1 15.4 19L16 7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 7V4H14V7" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    resend: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6H20V18H4V6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7L12 13L20 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cancel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12C21 16.97 16.97 21 12 21Z" stroke="currentColor" stroke-width="1.8"/><path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    pdf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4H14L18 8V20H8V4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 4V8H18" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    xml: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 4H14L18 8V20H8V4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 4V8H18" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    goal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/></svg>',
  };
  return icons[kind];
}
