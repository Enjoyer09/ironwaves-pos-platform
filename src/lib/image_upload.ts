const MAX_IMAGE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1280;
const OUTPUT_IMAGE_QUALITY = 0.82;

type ImagePrepareOptions = {
  maxFileBytes?: number;
  maxDimension?: number;
  outputQuality?: number;
  maxOutputChars?: number;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Şəkil faylı oxunmadı'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Şəkil açıla bilmədi'));
    img.src = dataUrl;
  });
}

function normalizeTargetSize(width: number, height: number, maxDimension = MAX_IMAGE_DIMENSION) {
  const maxSide = Math.max(width, height);
  if (!Number.isFinite(maxSide) || maxSide <= 0 || maxSide <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / maxSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareImageDataUrl(file: File, options: ImagePrepareOptions = {}): Promise<string> {
  const maxFileBytes = options.maxFileBytes ?? MAX_IMAGE_FILE_BYTES;
  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;
  const outputQuality = options.outputQuality ?? OUTPUT_IMAGE_QUALITY;
  const maxOutputChars = options.maxOutputChars ?? 2_000_000;
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Yalnız şəkil faylı seçin');
  }
  if (file.size > maxFileBytes) {
    throw new Error(`Şəkil maksimum ${Math.round(maxFileBytes / 1024)} KB ola bilər`);
  }

  const sourceDataUrl = await fileToDataUrl(file);
  const image = await dataUrlToImage(sourceDataUrl);
  const target = normalizeTargetSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);

  if (
    target.width === (image.naturalWidth || image.width) &&
    target.height === (image.naturalHeight || image.height) &&
    sourceDataUrl.length <= maxOutputChars &&
    file.size <= Math.min(350 * 1024, maxFileBytes)
  ) {
    return sourceDataUrl;
  }

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Şəkil emalı mümkün olmadı');
  }
  ctx.drawImage(image, 0, 0, target.width, target.height);

  const compressed = await new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Şəkil sıxılmadı'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Şəkil sıxılmış formada oxunmadı'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    }, 'image/jpeg', outputQuality);
  });

  if (compressed.length > maxOutputChars) {
    throw new Error('Şəkil hələ də çox böyükdür, daha kiçik fayl seçin');
  }
  return compressed;
}

export async function prepareSmallImageDataUrl(file: File): Promise<string> {
  return prepareImageDataUrl(file, {
    maxFileBytes: 768 * 1024,
    maxDimension: 640,
    outputQuality: 0.72,
    maxOutputChars: 350_000,
  });
}
