// Voucher photos come straight off a phone camera, and those run 3–12 MB —
// past the bucket's 5 MB cap (0005_storage_hardening.sql). A voucher only
// needs to be legible, so the photo is scaled down and re-encoded as JPEG
// before it is uploaded. That also settles the content type: the bucket only
// takes a fixed list of image types, and some phones hand over a file with an
// empty or unexpected one.

/** Mirrors the bucket's `file_size_limit`. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

/** Mirrors the bucket's `allowed_mime_types`. */
export const ALLOWED_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]

/** Longest side of the stored photo. Plenty to read a barcode or a code. */
export const MAX_PHOTO_DIMENSION = 1600

const JPEG_QUALITY = 0.82

/** Scales `width`×`height` so the longer side is at most `max`, keeping the
 *  aspect ratio. Never scales up. */
export function fitWithin(width: number, height: number, max: number) {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The extension to store a prepared photo under. */
export function extensionForType(type: string) {
  switch (type) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/heic':
      return 'heic'
    case 'image/heif':
      return 'heif'
    default:
      return 'jpg'
  }
}

async function decode(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Applies the EXIF orientation, so a portrait shot stays upright.
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Fall through to <img>, which some browsers decode more formats with.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Files this module has already produced, so a second pass is a no-op. */
const alreadyPrepared = new WeakSet<File>()

function remember(file: File) {
  alreadyPrepared.add(file)
  return file
}

function toJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
}

/**
 * Returns a photo ready for the bucket: a downscaled JPEG when the browser can
 * decode the image, otherwise the original file if the bucket would take it.
 * Throws with a message for the user when neither works.
 */
export async function preparePhoto(file: File): Promise<File> {
  // The form prepares a photo when it is picked, and the upload prepares again
  // as its own guarantee. Without this the second pass would re-encode an
  // already-shrunk JPEG, costing another generation of quality for nothing.
  if (alreadyPrepared.has(file)) return file

  try {
    const image = await decode(file)
    const { width, height } = fitWithin(image.width, image.height, MAX_PHOTO_DIMENSION)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      // JPEG has no transparency; keep a transparent PNG from turning black.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(image, 0, 0, width, height)
      if ('close' in image && typeof image.close === 'function') image.close()
      const blob = await toJpeg(canvas)
      if (blob && blob.size > 0 && blob.size <= MAX_PHOTO_BYTES) {
        return remember(new File([blob], 'voucher.jpg', { type: 'image/jpeg' }))
      }
    }
  } catch {
    // The browser can't decode it (e.g. HEIC outside Safari). Try it as is.
  }

  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    throw new Error('סוג הקובץ לא נתמך. נא לבחור תמונה בפורמט JPG או PNG.')
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('התמונה גדולה מדי (מעל 5MB). נא לבחור תמונה קטנה יותר.')
  }
  return remember(file)
}
