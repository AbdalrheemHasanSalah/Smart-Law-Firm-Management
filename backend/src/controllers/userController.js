import {
  getUserById,
  listUsers,
  updateUserRole,
  updateUserStatus,
} from '../services/userService.js';

export async function listUsersController(request, response, next) {
  try {
    const result = await listUsers(request.user, request.query);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

export async function getUserController(request, response, next) {
  try {
    const user = await getUserById(request.user, request.params.userId);
    return response.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

export async function updateUserRoleController(request, response, next) {
  try {
    const user = await updateUserRole(
      request.user,
      request.params.userId,
      request.body
    );
    return response.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

export async function updateUserStatusController(request, response, next) {
  try {
    const user = await updateUserStatus(
      request.user,
      request.params.userId,
      request.body
    );
    return response.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}
