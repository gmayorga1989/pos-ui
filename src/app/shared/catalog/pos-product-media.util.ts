/** Placeholder SVG (paquete) cuando el producto no tiene imagen. */
export const POS_PRODUCT_PLACEHOLDER_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
      <rect x="10" y="18" width="44" height="34" rx="6" stroke="#94a3b8" stroke-width="2"/>
      <path d="M10 26h44" stroke="#94a3b8" stroke-width="2"/>
      <path d="M22 18V12a4 4 0 014-4h12a4 4 0 014 4v6" stroke="#94a3b8" stroke-width="2"/>
      <circle cx="32" cy="38" r="6" stroke="#cbd5e1" stroke-width="1.5"/>
    </svg>`,
  );

export function resolveProductMediaUrl(imageUrl: string | null | undefined, apiBaseUrl: string): string {
  if (!imageUrl?.trim()) {
    return POS_PRODUCT_PLACEHOLDER_SVG;
  }
  const url = imageUrl.trim();
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  const base = apiBaseUrl.replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}
