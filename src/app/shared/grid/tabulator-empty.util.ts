import { escapeHtml } from './tabulator-formatters.util';



export type PosTabulatorEmptyContext = 'generic' | 'masters' | 'customers';



export const POS_TABULATOR_EMPTY_IMAGE = 'assets/iconos/plaholde_caja_tabulator.png';
export const POS_TABULATOR_EMPTY_CUSTOMERS_IMAGE = 'assets/iconos/place_holder_personas_tabulator.png';

export function posTabulatorEmptyImageFor(context: PosTabulatorEmptyContext): string {
  if (context === 'customers') {
    return POS_TABULATOR_EMPTY_CUSTOMERS_IMAGE;
  }
  return POS_TABULATOR_EMPTY_IMAGE;
}



const EMPTY_COPY: Record<PosTabulatorEmptyContext, { title: string; description: string; ctaLabel: string }> = {

  generic: {

    title: 'Sin datos para mostrar',

    description: 'No hay registros que coincidan con la búsqueda actual.',

    ctaLabel: '',

  },

  masters: {

    title: 'Sin registros en el catálogo',

    description: 'Agrega un ítem con el botón Agregar o ajusta los filtros de búsqueda.',

    ctaLabel: '+ Agregar primer producto',

  },

  customers: {

    title: 'Sin clientes registrados',

    description: 'Agrega un cliente con el botón Agregar o ajusta los filtros de búsqueda.',

    ctaLabel: '+ Agregar primer cliente',

  },

};



export interface PosTabulatorEmptyOptions {

  title?: string;

  description?: string;

  highlight?: string;

  imageSrc?: string;

  ctaLabel?: string;

  ctaAction?: string;

}



function buildHighlightedDescription(text: string, highlight: string): string {

  const needle = highlight.trim();

  if (!needle) {

    return escapeHtml(text);

  }

  const idx = text.indexOf(needle);

  if (idx < 0) {

    return escapeHtml(text);

  }

  const before = escapeHtml(text.slice(0, idx));

  const after = escapeHtml(text.slice(idx + needle.length));

  return `${before}<strong class="ts-tabulator-empty__highlight">${escapeHtml(needle)}</strong>${after}`;

}



export function buildPosTabulatorPlaceholder(

  context: PosTabulatorEmptyContext,

  overrides?: PosTabulatorEmptyOptions,

): string {

  const base = EMPTY_COPY[context];

  const title = overrides?.title?.trim() || base.title;

  const description = overrides?.description?.trim() || base.description;

  const highlight = overrides?.highlight?.trim() || 'Agregar';

  const imageSrc = overrides?.imageSrc?.trim() || posTabulatorEmptyImageFor(context);

  const ctaLabel =
    overrides && 'ctaLabel' in overrides ? overrides.ctaLabel?.trim() ?? '' : base.ctaLabel;

  const ctaAction = overrides?.ctaAction?.trim() || 'create';

  const descriptionHtml = buildHighlightedDescription(description, highlight);



  const ctaHtml = ctaLabel

    ? `<button type="button" class="ts-tabulator-empty__cta" data-pos-empty-action="${escapeHtml(ctaAction)}">${escapeHtml(ctaLabel)}</button>`

    : '';



  return `

    <div class="ts-tabulator-empty ts-tabulator-empty--stacked" role="status">

      <div class="ts-tabulator-empty__visual" aria-hidden="true">

        <img class="ts-tabulator-empty__image" src="${escapeHtml(imageSrc)}" alt="" loading="lazy" decoding="async" />

      </div>

      <div class="ts-tabulator-empty__content">

        <h3 class="ts-tabulator-empty__title">${escapeHtml(title)}</h3>

        <p class="ts-tabulator-empty__description">${descriptionHtml}</p>

      </div>

      ${ctaHtml}

    </div>

  `.trim();

}


