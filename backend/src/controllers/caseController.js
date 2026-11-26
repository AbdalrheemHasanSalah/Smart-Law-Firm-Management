import {
  assignStaffToCase,
  createCase,
  getCaseById,
  getCaseRelationships,
  linkClientToCase,
  listCases,
  removeStaffFromCase,
  updateCase,
} from '../services/caseService.js';
import { notifyLater } from '../services/notificationService.js';

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
    // A case opened for a client tells that client, as linking one from the case file does.
    if (caseRecord.client) {
      notifyLater('case.client_linked', { officeId: request.user.office_id, actorUserId: request.user.user_id, caseId: caseRecord.case_id, clientId: caseRecord.client.client_id });
    }
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
    if (request.body && Object.hasOwn(request.body, 'status')) {
      notifyLater('case.status_changed', { officeId: request.user.office_id, actorUserId: request.user.user_id, caseId: caseRecord.case_id, status: caseRecord.status });
    }
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
    notifyLater('case.client_linked', { officeId: request.user.office_id, actorUserId: request.user.user_id, caseId: relationship.case_id, clientId: relationship.client_id });
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
    notifyLater('case.staff_assigned', { officeId: request.user.office_id, actorUserId: request.user.user_id, caseId: assignment.case_id, userId: assignment.user_id });
    return response.status(201).json({ assignment });
  } catch (error) {
    return next(error);
  }
}

export async function removeStaffFromCaseController(request, response, next) {
  try {
    const removal = await removeStaffFromCase(request.user, request.params.caseId, request.params.userId);
    return response.status(200).json({ removal });
  } catch (error) {
    return next(error);
  }
}
