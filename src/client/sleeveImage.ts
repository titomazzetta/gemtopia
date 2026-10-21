/**
 * A photo of a record, made ready to read.
 *
 * Two things happen to every photo before it goes anywhere, both in the
 * browser:
 *
 *   1. It is drawn onto a canvas and re-encoded as a JPEG no larger than
 *      MAX_SIDE on its long side. That is what makes it small enough to send
 *      (a 12-megapixel sleeve photo is ~4 MB; this is ~200 KB) — and it is
 *      also what strips everything the camera wrote into the file: location,
 *      device, time. The server only ever sees pixels.
 *   2. If the browser can read barcodes itself (Chrome, Edge, Android), it
 *      tries that first. A barcode read on the phone means the photo never
 *      leaves it at all.
 *
 * No photo is stored: the object URL for the thumbnail is revoked when the
 * sheet closes, and nothing is written to IndexedDB or localStorage.
 */

export const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

export interface PreparedImage {
  /** The re-encoded JPEG. */
  blob: Blob;
  /** Its bytes as standard base64, for the reader. */
  base64: string;
  /** An object URL for showing the thumbnail. Revoke it when done. */
  url: string;
  width: number;
  height: number;
  /** The bitmap, for a barcode read; closed by `prepareImage`'s caller. */
  bitmap: ImageBitmap | HTMLImageElement;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // from-image: apply the EXIF rotation, so a phone's portrait photo
      // isn't read sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("not an image"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The scaled size: at most MAX_SIDE on the long side, never upscaled. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const source = await decode(file);
  const natural = sizeOf(source);
  if (natural.width === 0 || natural.height === 0) throw new Error("empty image");
  const { width, height } = fitWithin(natural.width, natural.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", JPEG_QUALITY);
  });
  const base64 = toBase64(await blob.arrayBuffer());
  return { blob, base64, url: URL.createObjectURL(blob), width, height, bitmap: source };
}

/* ------------------------------------------------------------------ */
/* Barcodes, on the device                                             */
/* ------------------------------------------------------------------ */

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const RETAIL_FORMATS = ["ean_13", "upc_a", "ean_8", "upc_e"];

/** Whether this browser can read a barcode without sending the photo anywhere. */
export function canReadBarcodesHere(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/**
 * The retail barcode in the photo, read by the browser, or null: not
 * supported here (Safari, as of writing), none in the picture, or unreadable.
 * Never throws — a failed read is a reason to ask the model, not an error.
 */
export async function readBarcodeHere(source: ImageBitmap | HTMLImageElement): Promise<string | null> {
  if (!canReadBarcodesHere()) return null;
  try {
    const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const supported = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : RETAIL_FORMATS;
    const formats = RETAIL_FORMATS.filter((f) => supported.includes(f));
    if (formats.length === 0) return null;
    const detector = new Ctor({ formats });
    const found = await detector.detect(source);
    const code = found.find((b) => /^\d{8,13}$/.test(b.rawValue.replace(/\D+/g, "")));
    return code ? code.rawValue : null;
  } catch {
    return null;
  }
}

/** Free the bitmap behind a prepared image, and its thumbnail URL. */
export function releaseImage(image: PreparedImage): void {
  if (!(image.bitmap instanceof HTMLImageElement)) image.bitmap.close();
  URL.revokeObjectURL(image.url);
}
