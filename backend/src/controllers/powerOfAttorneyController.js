import {
  attachPowerOfAttorneyScan,
  createPowerOfAttorney,
  getPowerOfAttorney,
  listAuthorizableLawyers,
  listPowersOfAttorney,
  readPowerOfAttorneyScan,
  updatePowerOfAttorney,
} from '../services/powerOfAttorneyService.js';

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

export const listPowersOfAttorneyController = handle((request) => listPowersOfAttorney(request.user, request.query));
export const listAuthorizableLawyersController = handle((request) => listAuthorizableLawyers(request.user));
export const getPowerOfAttorneyController = handle(async (request) => ({
  power_of_attorney: await getPowerOfAttorney(request.user, request.params.poaId),
}));
export const createPowerOfAttorneyController = handle(async (request) => ({
  power_of_attorney: await createPowerOfAttorney(request.user, request.body),
}), 201);
export const updatePowerOfAttorneyController = handle(async (request) => ({
  power_of_attorney: await updatePowerOfAttorney(request.user, request.params.poaId, request.body),
}));
export const attachPowerOfAttorneyScanController = handle((request) =>
  attachPowerOfAttorneyScan(request.user, request.params.poaId, request));

export async function downloadPowerOfAttorneyScanController(request, response, next) {
  try {
    const { buffer, mime } = await readPowerOfAttorneyScan(request.user, request.params.poaId);
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
