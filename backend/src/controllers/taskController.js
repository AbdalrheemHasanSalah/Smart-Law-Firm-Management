import {
  createTask,
  getTaskById,
  listTasks,
  updateTask,
} from '../services/taskService.js';

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
    return response.status(200).json({ task });
  } catch (error) {
    return next(error);
  }
}
