export const POS_PRODUCT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const POS_PRODUCT_IMAGE_MAX_WIDTH = 1024;
export const POS_PRODUCT_IMAGE_MAX_HEIGHT = 1024;
export const POS_PRODUCT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
export const POS_PRODUCT_IMAGE_HINT = `PNG, JPEG o WebP · máx. 3 MB · ${POS_PRODUCT_IMAGE_MAX_WIDTH}×${POS_PRODUCT_IMAGE_MAX_HEIGHT} px`;

const ACCEPT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('invalid image'));
    };
    img.src = url;
  });
}

/** Devuelve mensaje de error o null si el archivo es válido. */
export async function validateProductImageFile(file: File): Promise<string | null> {
  if (!ACCEPT_TYPES.has(file.type)) {
    return 'Formato no permitido. Use PNG, JPEG o WebP.';
  }
  if (file.size > POS_PRODUCT_IMAGE_MAX_BYTES) {
    return 'La imagen no puede superar 3 MB.';
  }
  try {
    const { width, height } = await readImageDimensions(file);
    if (width > POS_PRODUCT_IMAGE_MAX_WIDTH || height > POS_PRODUCT_IMAGE_MAX_HEIGHT) {
      return `Dimensiones máximas ${POS_PRODUCT_IMAGE_MAX_WIDTH}×${POS_PRODUCT_IMAGE_MAX_HEIGHT} px.`;
    }
  } catch {
    return 'No se pudo leer la imagen seleccionada.';
  }
  return null;
}
