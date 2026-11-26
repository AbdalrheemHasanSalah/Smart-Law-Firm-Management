import { generateHearingPrep, listHearingPreps } from '../services/hearingPrepService.js';

export async function listHearingPrepsController(request, response, next) {
  try {
    return response.status(200).json(await listHearingPreps(request.user, request.params.caseId));
  } catch (error) {
    return next(error);
  }
}

export async function generateHearingPrepController(request, response, next) {
  try {
    return response.status(201).json(await generateHearingPrep(request.user, request.params.caseId, request.body));
  } catch (error) {
    return next(error);
  }
}
