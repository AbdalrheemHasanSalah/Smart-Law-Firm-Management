import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { readClip, uploadClip } from '../services/voiceService.js';

/**
 * Voice recordings: upload one (raw audio body, X-Duration-Seconds header), then attach it by id
 * to a message or a case note; play it back where that message or note is readable.
 */
const router = Router();
const everyone = [requireAuth, requireRole(['admin', 'lawyer', 'assistant', 'client'])];
const uploadLimit = createRateLimit({ maxRequests: 30 });

router.post('/voice', uploadLimit, ...everyone, async (request, response, next) => {
  try {
    return response.status(201).json(await uploadClip(request.user, request));
  } catch (error) {
    return next(error);
  }
});

/** Plays the clip, honouring a single byte range: Safari will not play audio without one. */
router.get('/voice/:clipId', ...everyone, async (request, response, next) => {
  try {
    const { buffer, mime } = await readClip(request.user, request.params.clipId);
    response.setHeader('Content-Type', mime);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const size = buffer.length;
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        response.setHeader('Content-Range', `bytes */${size}`);
        return response.status(416).end();
      }
      response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      return response.status(206).send(buffer.subarray(start, end + 1));
    }
    return response.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
});

export default router;
