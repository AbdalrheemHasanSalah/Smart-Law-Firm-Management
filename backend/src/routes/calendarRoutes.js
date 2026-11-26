import { Router } from 'express';
import {
  createAppointmentController,
  createHearingController,
  listCalendarController,
  updateAppointmentController,
  updateHearingController,
} from '../controllers/calendarController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

/** The office calendar: hearings, appointments and dated obligations. */
const router = Router();
const admin = [requireAuth, requireRole('admin')];

// Every staff member reads their own slice; only the administrator schedules.
router.get('/', requireAuth, requireRole(['admin', 'lawyer', 'assistant']), listCalendarController);
router.post('/hearings', ...admin, createHearingController);
router.patch('/hearings/:hearingId', ...admin, updateHearingController);
router.post('/appointments', ...admin, createAppointmentController);
router.patch('/appointments/:appointmentId', ...admin, updateAppointmentController);

export default router;
