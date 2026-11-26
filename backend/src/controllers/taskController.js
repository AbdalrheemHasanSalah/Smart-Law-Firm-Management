import {
  createPrivateTask,
  createTask,
  deletePrivateTask,
  getTaskById,
  listTasks,
  updateTask,
} from '../services/taskService.js';
import { notifyLater } from '../services/notificationService.js';

export async function listTasksController(request, response, next) {
  try {
    const result = await listTasks(request.user, request.query);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

export async function createTaskController(request, response, next) {
  try {
    const task = await createTask(request.user, request.body);
    notifyLater('task.assigned', { officeId: request.user.office_id, actorUserId: request.user.user_id, userId: request.body?.assigned_to_user_id });
    return response.status(201).json({ task });
  } catch (error) {
    return next(error);
  }
}

export async function getTaskController(request, response, next) {
  try {
    const task = await getTaskById(request.user, request.params.taskId);
    return response.status(200).json({ task });
  } catch (error) {
    return next(error);
  }
}

export async function updateTaskController(request, response, next) {
  try {
    const task = await updateTask(
      request.user,
      request.params.taskId,
      request.body
    );
    // Finishing one's own private task tells nobody.
    if (request.body?.status === 'completed' && !task.is_private) {
      notifyLater('task.completed', { officeId: request.user.office_id, actorUserId: request.user.user_id });
    }
    return response.status(200).json({ task });
  } catch (error) {
    return next(error);
  }
}

export async function createPrivateTaskController(request, response, next) {
  try {
    const task = await createPrivateTask(request.user, request.body);
    return response.status(201).json({ task });
  } catch (error) {
    return next(error);
  }
}

export async function deletePrivateTaskController(request, response, next) {
  try {
    await deletePrivateTask(request.user, request.params.taskId);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
}
