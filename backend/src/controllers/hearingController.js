import { listCaseHearings, listClientUpcomingHearings, recordHearingOutcome } from '../services/hearingService.js';

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

export const listCaseHearingsController = handle((request) => {
  const { caseId, ...rest } = request.query ?? {};
  if (Object.keys(rest).length) {
    const error = new Error('Unsupported hearing query parameter.');
    error.status = 400;
    error.publicCode = 'VALIDATION';
    throw error;
  }
  return listCaseHearings(request.user, caseId);
});
export const recordHearingOutcomeController = handle(async (request) => ({
  hearing: await recordHearingOutcome(request.user, request.params.hearingId, request.body),
}));
export const listClientUpcomingHearingsController = handle((request) => listClientUpcomingHearings(request.user));
