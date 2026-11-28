import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Small private files (a photo or a PDF): payment receipts and the scans of powers of attorney.
 * They are kept in private storage, beside the case documents and never under a public folder.
 * Files are named by a random key, and the type is decided from the file's first bytes, not
 * from what the browser claims.
 */

const SERVICE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DOCUMENT_STORAGE_DIR
  ? path.resolve(process.env.DOCUMENT_STORAGE_DIR)
  : path.resolve(SERVICE_DIRECTORY, '../../private-documents');
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|webm|ogg|m4a)$/i;

const SIGNATURES = [
  { extension: 'pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-') },
  { extension: 'png', mime: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { extension: 'jpg', mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
];

export const RECEIPT_TYPES = new Set(SIGNATURES.map((entry) => entry.mime));

/**
 * Voice recordings as browsers make them: WebM/Opus (Chrome, Edge, Firefox), Ogg/Opus (Firefox)
 * and MP4/AAC (Safari, iOS). `offset` is where the signature starts (MP4 has "ftyp" at byte 4).
 */
export const AUDIO_SIGNATURES = [
  { extension: 'webm', mime: 'audio/webm', bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
  { extension: 'ogg', mime: 'audio/ogg', bytes: Buffer.from('OggS') },
  { extension: 'm4a', mime: 'audio/mp4', bytes: Buffer.from('ftyp'), offset: 4 },
];

/** The type among `signatures` that the buffer starts with, or null. */
export function detectType(buffer, signatures) {
  return (
    signatures.find((entry) => {
      const start = entry.offset ?? 0;
      return buffer.length >= start + entry.bytes.length && buffer.subarray(start, start + entry.bytes.length).equals(entry.bytes);
    }) ?? null
  );
}

export class ReceiptError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'ReceiptError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

/** The file type from its first bytes, or null when it is not a PDF, PNG or JPEG. */
export function detectReceiptType(buffer) {
  return SIGNATURES.find((entry) => buffer.length >= entry.bytes.length && buffer.subarray(0, entry.bytes.length).equals(entry.bytes)) ?? null;
}

export const mimeOfKey = (key) => [...SIGNATURES, ...AUDIO_SIGNATURES].find((entry) => key.toLowerCase().endsWith(`.${entry.extension}`))?.mime ?? 'application/octet-stream';

/**
 * A store of small PDF/PNG/JPG files in its own private folder. `noun` names the file in error
 * messages ("receipt", "scan").
 */
export function createFileStore({ folder, noun, maxBytes = MAX_RECEIPT_BYTES, signatures = SIGNATURES }) {
  const storeDirectory = path.join(ROOT, folder);
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const megabytes = Math.round(maxBytes / (1024 * 1024));

  /** Reads the request body up to the size limit, without buffering more than that. */
  async function readBody(request) {
    const declared = request.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      throw new ReceiptError(413, `The ${noun} is larger than ${megabytes} MB.`, 'VALIDATION');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new ReceiptError(413, `The ${noun} is larger than ${megabytes} MB.`, 'VALIDATION');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) throw new ReceiptError(400, `The ${noun} file is empty.`, 'VALIDATION');
    return buffer;
  }

  async function directory() {
    await mkdir(storeDirectory, { recursive: true, mode: 0o700 });
    return realpath(storeDirectory);
  }

  /** Saves a checked file and returns its storage key. */
  async function save(buffer) {
    const type = detectType(buffer, signatures);
    if (!type) {
      const allowed = signatures.map((entry) => entry.extension.toUpperCase()).join(', ');
      throw new ReceiptError(415, `The ${noun} must be one of: ${allowed}.`, 'VALIDATION');
    }
    const key = `${randomUUID()}.${type.extension}`;
    const handle = await open(path.join(await directory(), key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await handle.writeFile(buffer);
    } finally {
      await handle.close();
    }
    return key;
  }

  async function read(key) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new ReceiptError(404, `${Noun} not found.`, 'NOT_FOUND');
    const filePath = path.join(await directory(), key);
    let handle;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      if (!(await handle.stat()).isFile()) throw new ReceiptError(404, `${Noun} not found.`, 'NOT_FOUND');
      return { buffer: await handle.readFile(), mime: mimeOfKey(key) };
    } catch (error) {
      if (error instanceof ReceiptError) throw error;
      if (error?.code === 'ENOENT') throw new ReceiptError(404, `${Noun} not found.`, 'NOT_FOUND');
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async function remove(key) {
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return;
    await rm(path.join(await directory(), key), { force: true }).catch(() => {});
  }

  return { readBody, save, read, remove };
}

const receipts = createFileStore({ folder: 'receipts', noun: 'receipt' });

export const readReceiptBody = receipts.readBody;
export const saveReceipt = receipts.save;
export const readReceipt = receipts.read;
export const removeReceipt = receipts.remove;
