import {
  attachCourtNoticeFile,
  createCourtNotice,
  listCourtNotices,
  readCourtNoticeFile,
  updateCourtNotice,
} from '../services/courtNoticeService.js';

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

export const listCourtNoticesController = handle((request) => listCourtNotices(request.user, request.query));
export const createCourtNoticeController = handle(async (request) => ({
  court_notice: await createCourtNotice(request.user, request.body),
}), 201);
export const updateCourtNoticeController = handle(async (request) => ({
  court_notice: await updateCourtNotice(request.user, request.params.noticeId, request.body),
}));
export const attachCourtNoticeFileController = handle((request) =>
  attachCourtNoticeFile(request.user, request.params.noticeId, request));

export async function downloadCourtNoticeFileController(request, response, next) {
  try {
    const { buffer, mime } = await readCourtNoticeFile(request.user, request.params.noticeId);
    response.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.status(200).end(buffer);
  } catch (error) {
    return next(error);
  }
}
