import { query } from '../config/db.js';
import { officeCondition } from './officeScope.js';
import { AUDIO_SIGNATURES, createFileStore, detectType } from './receiptStorage.js';

/**
 * Voice messages (الرسائل الصوتية).
 *
 *   1. upload     the recording alone (raw audio body); it belongs to its owner and nobody else
 *   2. attach     sending a message or saving a case note names the clip; it is attached once
 *   3. listen     whoever can read that message or note can play the clip, and nobody else
 *
 * The type is decided from the file's first bytes (WebM, Ogg or MP4 audio), never from what the
 * browser says. A clip is at most MAX_SECONDS long and MAX_BYTES in size. Clips never attached
 * (a recording discarded, a send that failed) are removed after a day.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['admin', 'lawyer', 'assistant', 'client'];
export const MAX_SECONDS = 120;
export const MAX_BYTES = 3 * 1024 * 1024;
const UNATTACHED_LIFETIME = '1 day';

const clips = createFileStore({ folder: 'voice', noun: 'recording', maxBytes: MAX_BYTES, signatures: AUDIO_SIGNATURES });

export class VoiceError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

const invalid = (message) => {
  throw new VoiceError(400, message, 'VALIDATION');
};
const notFound = () => {
  throw new VoiceError(404, 'Recording not found.', 'NOT_FOUND');
};

function assertActor(actor) {
  if (!actor || !ROLES.includes(actor.role) || typeof actor.user_id !== 'string' || !UUID_PATTERN.test(actor.user_id)) {
    throw new VoiceError(403, 'You do not have permission to access this resource.', 'FORBIDDEN');
  }
}

export const isClipId = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

/** Removes the office's recordings that were never attached, with their files. */
async function sweepUnattached(officeId) {
  const removed = await query(
    `DELETE FROM voice_clips
      WHERE office_id = $1 AND message_id IS NULL AND note_id IS NULL AND created_at < NOW() - INTERVAL '${UNATTACHED_LIFETIME}'
      RETURNING storage_key`,
    [officeId]
  );
  await Promise.all(removed.rows.map((row) => clips.remove(row.storage_key)));
}

/** Stores a recording for its owner. The duration (whole seconds) comes in X-Duration-Seconds. */
export async function uploadClip(actor, request) {
  assertActor(actor);
  officeCondition(actor, [], 'office');
  const duration = Number(request.headers['x-duration-seconds']);
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_SECONDS) {
    invalid(`X-Duration-Seconds must be a whole number of seconds from 1 to ${MAX_SECONDS}.`);
  }
  const buffer = await clips.readBody(request);
  const type = detectType(buffer, AUDIO_SIGNATURES);
  if (!type) throw new VoiceError(415, 'The recording must be WebM, Ogg or MP4 audio.', 'VALIDATION');
  const key = await clips.save(buffer);
  try {
    const result = await query(
      `INSERT INTO voice_clips (office_id, owner_user_id, storage_key, mime_type, duration_seconds, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING clip_id, duration_seconds, created_at`,
      [actor.office_id, actor.user_id, key, type.mime, duration, buffer.length]
    );
    // Cleaning up here keeps the store small without a scheduled job.
    sweepUnattached(actor.office_id).catch(() => {});
    return { clip: result.rows[0] };
  } catch (error) {
    await clips.remove(key);
    throw error;
  }
}

/**
 * The actor's own unattached clip, checked before a message or note is saved with it.
 * Returns its duration.
 */
export async function assertOwnFreeClip(actor, clipId, run = query) {
  if (!isClipId(clipId)) invalid('voice_clip_id must be a valid UUID.');
  const result = await run(
    `SELECT duration_seconds FROM voice_clips
      WHERE clip_id = $1 AND owner_user_id = $2 AND office_id = $3 AND message_id IS NULL AND note_id IS NULL`,
    [clipId, actor.user_id, actor.office_id]
  );
  if (!result.rowCount) invalid('The recording was not found or is already used.');
  return result.rows[0].duration_seconds;
}

/** Attaches the clip to a message or a note; false when it was taken in the meantime. */
export async function attachClip(actor, clipId, { messageId = null, noteId = null }, run = query) {
  const result = await run(
    `UPDATE voice_clips SET message_id = $4, note_id = $5
      WHERE clip_id = $1 AND owner_user_id = $2 AND office_id = $3 AND message_id IS NULL AND note_id IS NULL
      RETURNING clip_id`,
    [clipId, actor.user_id, actor.office_id, messageId, noteId]
  );
  return result.rowCount > 0;
}

/**
 * Who may listen: the owner of an unattached clip; the sender and receiver of its message; and
 * whoever can read its case note (the same rules as the notes list: the admin, the case team, and
 * the case's client for a client-visible note).
 */
async function findReadableClip(actor, clipId) {
  if (!isClipId(clipId)) notFound();
  const parameters = [clipId, actor.user_id];
  const office = officeCondition(actor, parameters, 'v');
  const noteRule =
    actor.role === 'admin'
      ? 'TRUE'
      : actor.role === 'client'
        ? `n.visibility = 'client_visible' AND EXISTS (
             SELECT 1 FROM involves i JOIN clients c ON c.client_id = i.client_id
              WHERE i.case_id = n.case_id AND c.user_id = $2)`
        : 'EXISTS (SELECT 1 FROM assigned_to a WHERE a.case_id = n.case_id AND a.user_id = $2)';
  const result = await query(
    `SELECT v.storage_key, v.mime_type
       FROM voice_clips v
       LEFT JOIN messages m ON m.message_id = v.message_id AND m.office_id = v.office_id
       LEFT JOIN case_notes n ON n.note_id = v.note_id AND n.office_id = v.office_id
      WHERE v.clip_id = $1 AND ${office}
        AND (
          (v.message_id IS NULL AND v.note_id IS NULL AND v.owner_user_id = $2)
          OR (m.message_id IS NOT NULL AND (m.sender_user_id = $2 OR m.receiver_user_id = $2))
          OR (n.note_id IS NOT NULL AND ${noteRule})
        )`,
    parameters
  );
  if (!result.rowCount) notFound();
  return result.rows[0];
}

export async function readClip(actor, clipId) {
  assertActor(actor);
  const row = await findReadableClip(actor, clipId);
  const file = await clips.read(row.storage_key);
  return { buffer: file.buffer, mime: row.mime_type };
}

/** The clip as JSON for a message or note row that LEFT JOINed voice_clips as v. */
export const VOICE_COLUMNS = 'v.clip_id AS voice_clip_id, v.duration_seconds AS voice_duration_seconds';

export const publicVoice = (row) => (row.voice_clip_id ? { clip_id: row.voice_clip_id, duration_seconds: row.voice_duration_seconds } : null);
