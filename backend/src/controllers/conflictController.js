import { listAuditLog, verifyAuditChain } from '../services/auditService.js';
import { checkConflicts } from '../services/conflictService.js';
import { addOpponent, listOpponents, removeOpponent } from '../services/opponentService.js';

export async function checkConflictsController(request, response, next) {
  try {
    return response.status(200).json(await checkConflicts(request.user, request.query));
  } catch (error) {
    return next(error);
  }
}

export async function listOpponentsController(request, response, next) {
  try {
    const opponents = await listOpponents(request.user, request.params.caseId);
    return response.status(200).json({ opponents });
  } catch (error) {
    return next(error);
  }
}

export async function addOpponentController(request, response, next) {
  try {
    const result = await addOpponent(request.user, request.params.caseId, request.body);
    return response.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

export async function removeOpponentController(request, response, next) {
  try {
    await removeOpponent(request.user, request.params.caseId, request.params.opponentId);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
}

export async function listAuditLogController(request, response, next) {
  try {
    return response.status(200).json(await listAuditLog(request.user, request.query));
  } catch (error) {
    return next(error);
  }
}

export async function verifyAuditChainController(request, response, next) {
  try {
    return response.status(200).json(await verifyAuditChain(request.user));
  } catch (error) {
    return next(error);
  }
}
