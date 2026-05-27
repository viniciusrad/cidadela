const MAX_IMAGES = 4;
const MAX_BYTES_PER_IMAGE = 4 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

export type ImageValidationResult =
  | { ok: true; base64Images: string[] }
  | { ok: false; error: string };

export function extractBase64Images(value: unknown): ImageValidationResult {
  if (value === undefined || value === null) {
    return { ok: true, base64Images: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: "Campo 'images' deve ser uma lista." };
  }
  if (value.length > MAX_IMAGES) {
    return {
      ok: false,
      error: `Maximo de ${MAX_IMAGES} imagens por conversa.`,
    };
  }

  const base64Images: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      return { ok: false, error: "Imagem invalida na lista." };
    }
    const match = entry.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return {
        ok: false,
        error: "Imagem deve estar em data URL base64 (ex.: data:image/png;base64,...).",
      };
    }
    const [, mime, base64] = match;
    if (!ALLOWED_MIME.test(mime)) {
      return {
        ok: false,
        error: `Tipo de imagem nao suportado: ${mime}. Use PNG, JPEG, WEBP ou GIF.`,
      };
    }
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_BYTES_PER_IMAGE) {
      return {
        ok: false,
        error: `Imagem maior que ${MAX_BYTES_PER_IMAGE / (1024 * 1024)} MB.`,
      };
    }
    base64Images.push(base64);
  }

  return { ok: true, base64Images };
}
