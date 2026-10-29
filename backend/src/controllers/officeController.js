import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
} from '../services/invitationService.js';
import {
  clearActiveOffice,
  listMemberships,
  registerOffice,
  selectActiveOffice,
} from '../services/officeService.js';
import { listOffices, reviewOffice, updateAccountStatus } from '../services/platformService.js';

const handle = (action, status = 200) => async (request, response, next) => {
  try {
    const result = await action(request);
    return response.status(status).json(result);
  } catch (error) {
    return next(error);
  }
};

export const registerOfficeController = handle(
  async (request) => ({ office: await registerOffice(request.user, request.body) }),
  201
);

export const listMembershipsController = handle(
  async (request) => ({ memberships: await listMemberships(request.user) })
);

export const selectOfficeController = handle(
  (request) => selectActiveOffice(request.user, request.session?.session?.id, request.body)
);

export const clearOfficeController = handle(async (request) => {
  await clearActiveOffice(request.user, request.session?.session?.id);
  return { office_id: null };
});

export const createInvitationController = handle(
  (request) => createInvitation(request.user, request.body),
  201
);

export const listInvitationsController = handle(
  async (request) => ({ invitations: await listInvitations(request.user) })
);

export const revokeInvitationController = handle(
  (request) => revokeInvitation(request.user, request.params.invitationId)
);

export const previewInvitationController = handle(
  async (request) => ({ invitation: await previewInvitation(request.params.token) })
);

export const acceptInvitationController = handle(
  (request) => acceptInvitation(
    request.user,
    request.session?.session?.id,
    request.params.token,
    request.body
  )
);

export const listPlatformOfficesController = handle(
  async (request) => ({ offices: await listOffices(request.user, request.query) })
);

export const reviewOfficeController = handle(
  async (request) => ({ office: await reviewOffice(request.user, request.params.officeId, request.body) })
);

export const updateAccountStatusController = handle(
  async (request) => ({ user: await updateAccountStatus(request.user, request.params.userId, request.body) })
);
