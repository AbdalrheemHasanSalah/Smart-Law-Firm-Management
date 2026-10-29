import {
  assignStaffToCase,
  createCase,
  getCaseById,
  getCaseRelationships,
  linkClientToCase,
  listCases,
  updateCase,
} from '../services/caseService.js';

export async function listCasesController(request, response, next) {
  try {
    const result = await listCases(request.user, request.query);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

export async function createCaseController(request, response, next) {
  try {
    const caseRecord = await createCase(request.user, request.body);
    return response.status(201).json({ case: caseRecord });
  } catch (error) {
    return next(error);
  }
}

export async function getCaseController(request, response, next) {
  try {
    const caseRecord = await getCaseById(request.user, request.params.caseId);
    return response.status(200).json({ case: caseRecord });
  } catch (error) {
    return next(error);
  }
}

export async function updateCaseController(request, response, next) {
  try {
    const caseRecord = await updateCase(
      request.user,
      request.params.caseId,
      request.body
    );
    return response.status(200).json({ case: caseRecord });
  } catch (error) {
    return next(error);
  }
}

export async function getCaseRelationshipsController(request, response, next) {
  try {
    const relationships = await getCaseRelationships(
      request.user,
      request.params.caseId
    );
    return response.status(200).json({ relationships });
  } catch (error) {
    return next(error);
  }
}

export async function linkClientToCaseController(request, response, next) {
  try {
    const relationship = await linkClientToCase(
      request.user,
      request.params.caseId,
      request.body
    );
    return response.status(201).json({ relationship });
  } catch (error) {
    return next(error);
  }
}

export async function assignStaffToCaseController(request, response, next) {
  try {
    const assignment = await assignStaffToCase(
      request.user,
      request.params.caseId,
      request.body
    );
    return response.status(201).json({ assignment });
  } catch (error) {
    return next(error);
  }
}
