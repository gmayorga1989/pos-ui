/** Resuelve rutas de `src/assets` respetando `<base href>`. */
export function resolvePosAssetUrl(assetPath: string): string {
  const normalized = assetPath.replace(/^\/+/, '');
  if (typeof document === 'undefined') {
    return `/${normalized}`;
  }
  const base = document.querySelector('base')?.href ?? `${window.location.origin}/`;
  return new URL(normalized, base).href;
}
