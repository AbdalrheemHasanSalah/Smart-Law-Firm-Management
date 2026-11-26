import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Payment receipts (a photo or a PDF of a transfer slip) kept in private storage, beside the
 * case documents and never under a public folder. Files are named by a random key, and the type
 * is decided from the file's first bytes, not from what the browser claims.
 */

const SERVICE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DOCUMENT_STORAGE_DIR
  ? path.resolve(process.env.DOCUMENT_STORAGE_DIR)
  : path.resolve(SERVICE_DIRECTORY, '../../private-documents');
const RECEIPT_DIRECTORY = path.join(ROOT, 'receipts');
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)$/i;

const SIGNATURES = [
  { extension: 'pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-') },
  { extension: 'png', mime: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { extension: 'jpg', mime: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) },
];

export const RECEIPT_TYPES = new Set(SIGNATURES.map((entry) => entry.mime));

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

export const mimeOfKey = (key) => SIGNATURES.find((entry) => key.toLowerCase().endsWith(`.${entry.extension}`))?.mime ?? 'application/octet-stream';

/** Reads the request body up to the size limit, without buffering more than that. */
export async function readReceiptBody(request) {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_RECEIPT_BYTES)) {
    throw new ReceiptError(413, 'The receipt is larger than 5 MB.', 'VALIDATION');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_RECEIPT_BYTES) throw new ReceiptError(413, 'The receipt is larger than 5 MB.', 'VALIDATION');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) throw new ReceiptError(400, 'The receipt file is empty.', 'VALIDATION');
  return buffer;
}

async function directory() {
  await mkdir(RECEIPT_DIRECTORY, { recursive: true, mode: 0o700 });
  return realpath(RECEIPT_DIRECTORY);
}

/** Saves a checked receipt and returns its storage key. */
export async function saveReceipt(buffer) {
  const type = detectReceiptType(buffer);
  if (!type) throw new ReceiptError(415, 'The receipt must be a PDF, PNG or JPG file.', 'VALIDATION');
  const key = `${randomUUID()}.${type.extension}`;
  const handle = await open(path.join(await directory(), key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
  return key;
}

export async function readReceipt(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new ReceiptError(404, 'Receipt not found.', 'NOT_FOUND');
  const filePath = path.join(await directory(), key);
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!(await handle.stat()).isFile()) throw new ReceiptError(404, 'Receipt not found.', 'NOT_FOUND');
    return { buffer: await handle.readFile(), mime: mimeOfKey(key) };
  } catch (error) {
    if (error instanceof ReceiptError) throw error;
    if (error?.code === 'ENOENT') throw new ReceiptError(404, 'Receipt not found.', 'NOT_FOUND');
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function removeReceipt(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return;
  await rm(path.join(await directory(), key), { force: true }).catch(() => {});
}
