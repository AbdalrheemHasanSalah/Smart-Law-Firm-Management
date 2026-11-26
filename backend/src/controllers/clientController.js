import {
  createClient,
  getClientById,
  listClientCases,
  getOwnClient,
  listClients,
  linkClientAccount,
  updateClient,
  updateOwnClient,
} from '../services/clientService.js';

function sendError(next, error) {
  return next(error);
}

export async function listClientsController(request, response, next) {
  try {
    const result = await listClients(request.user, request.query);
    return response.status(200).json(result);
  } catch (error) {
    return sendError(next, error);
  }
}

export async function getClientController(request, response, next) {
  try {
    const client = await getClientById(request.user, request.params.clientId);
    return response.status(200).json({ client });
  } catch (error) {
    return sendError(next, error);
  }
}

export async function listClientCasesController(request, response, next) {
  try {
    const result = await listClientCases(
      request.user,
      request.params.clientId,
      request.query
    );
    return response.status(200).json(result);
  } catch (error) {
    return sendError(next, error);
  }
}

export async function createClientController(request, response, next) {
  try {
    const client = await createClient(request.user, request.body);
    return response.status(201).json({ client });
  } catch (error) {
    return sendError(next, error);
  }
}

export async function linkClientAccountController(request, response, next) {
  try {
    const result = await linkClientAccount(
      request.user,
      request.params.clientId,
      request.body
    );
    return response.status(200).json(result);
  } catch (error) {
    return sendError(next, error);
  }
}

export async function updateClientController(request, response, next) {
  try {
    const client = await updateClient(
      request.user,
      request.params.clientId,
      request.body
    );
    return response.status(200).json({ client });
  } catch (error) {
    return sendError(next, error);
  }
}

export async function getOwnClientController(request, response, next) {
  try {
    const client = await getOwnClient(request.user);
    return response.status(200).json({ client });
  } catch (error) {
    return sendError(next, error);
  }
}

export async function updateOwnClientController(request, response, next) {
  try {
    const client = await updateOwnClient(request.user, request.body);
    return response.status(200).json({ client });
  } catch (error) {
    return sendError(next, error);
  }
}
