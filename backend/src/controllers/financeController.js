import {
  cancelInvoice,
  clientStatement,
  createInvoice,
  financeSummary,
  listInvoices,
  ownStatement,
  recordPayment,
} from '../services/financeService.js';

const respond = (status, work) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

export const listInvoicesController = respond(200, (request) => listInvoices(request.user, request.query));
export const createInvoiceController = respond(201, async (request) => ({ invoice: await createInvoice(request.user, request.body) }));
export const cancelInvoiceController = respond(200, async (request) => ({ invoice: await cancelInvoice(request.user, request.params.invoiceId) }));
export const recordPaymentController = respond(201, (request) => recordPayment(request.user, request.params.invoiceId, request.body));
export const financeSummaryController = respond(200, (request) => financeSummary(request.user));
export const clientStatementController = respond(200, async (request) => ({ statement: await clientStatement(request.user, request.params.clientId) }));
export const ownStatementController = respond(200, async (request) => ({ statement: await ownStatement(request.user) }));
