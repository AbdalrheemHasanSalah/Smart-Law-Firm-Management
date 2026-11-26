import { createAppointment, createHearing, listCalendar, updateAppointment, updateHearing } from '../services/calendarService.js';

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

export const listCalendarController = handle((request) => listCalendar(request.user, request.query));
export const createHearingController = handle(async (request) => ({ hearing: await createHearing(request.user, request.body) }), 201);
export const updateHearingController = handle(async (request) => ({ hearing: await updateHearing(request.user, request.params.hearingId, request.body) }));
export const createAppointmentController = handle(async (request) => ({ appointment: await createAppointment(request.user, request.body) }), 201);
export const updateAppointmentController = handle(async (request) => ({ appointment: await updateAppointment(request.user, request.params.appointmentId, request.body) }));
