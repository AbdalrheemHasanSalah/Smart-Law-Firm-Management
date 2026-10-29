import {
  createCaseNote,
  listCaseNotes,
  updateCaseNote,
} from '../services/caseNoteService.js';

export async function listCaseNotesController(request, response, next) {
  try {
    return response.status(200).json(
      await listCaseNotes(request.user, request.params.caseId, request.query)
    );
  } catch (error) {
    return next(error);
  }
}

export async function createCaseNoteController(request, response, next) {
  try {
    return response.status(201).json({
      note: await createCaseNote(
        request.user,
        request.params.caseId,
        request.body
      ),
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateCaseNoteController(request, response, next) {
  try {
    return response.status(200).json({
      note: await updateCaseNote(
        request.user,
        request.params.noteId,
        request.body
      ),
    });
  } catch (error) {
    return next(error);
  }
}
