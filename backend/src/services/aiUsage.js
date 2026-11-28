import { query } from '../config/db.js';
import { AiError } from './aiProvider.js';

/**
 * The office's monthly allowance of AI requests: AI_MONTHLY_ANALYSES_PER_LAWYER (40 by default)
 * for each lawyer the office pays for (its active admins and lawyers, at least one, as the
 * subscription counts them). Case analyses, AI drafts and AI hearing-preparation sheets count; the free
 * "basic" sheet, which calls no model, does not. Months follow the office's local calendar
 * (REMINDER_TIMEZONE, Palestine by default).
 *
 * The check runs before anything is read or sent, so a request over the allowance costs nothing.
 */

const DEFAULT_PER_LAWYER = 40;

export function allowancePerLawyer(env = process.env) {
  const value = Number(env.AI_MONTHLY_ANALYSES_PER_LAWYER);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PER_LAWYER;
}

const timezone = (env = process.env) => (typeof env.REMINDER_TIMEZONE === 'string' && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(env.REMINDER_TIMEZONE) ? env.REMINDER_TIMEZONE : 'Asia/Hebron');

/** This month's use and limit for the actor's office. */
export async function monthlyUsage(actor) {
  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM case_ai_analyses a
         WHERE a.office_id = $1 AND a.created_at >= date_trunc('month', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
     + (SELECT COUNT(*)::int FROM ai_interactions i
         WHERE i.office_id = $1 AND i.question LIKE 'hearing_prep%' AND i.model_name <> 'basic'
           AND i.created_at >= date_trunc('month', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
     + (SELECT COUNT(*)::int FROM case_drafts d
         WHERE d.office_id = $1 AND d.source = 'ai'
           AND d.created_at >= date_trunc('month', NOW() AT TIME ZONE $2) AT TIME ZONE $2) AS used,
       GREATEST(1, (SELECT COUNT(*)::int FROM office_memberships m JOIN roles r ON r.role_id = m.role_id
                     WHERE m.office_id = $1 AND m.status = 'active' AND r.role_name IN ('admin', 'lawyer'))) AS lawyers`,
    [actor.office_id, timezone()]
  );
  const row = result.rows[0] ?? { used: 0, lawyers: 1 };
  return { used: row.used, limit: row.lawyers * allowancePerLawyer(), per_lawyer: allowancePerLawyer(), lawyers: row.lawyers };
}

/** Throws AI_LIMIT_REACHED when the office has used this month's allowance. */
export async function assertWithinAllowance(actor) {
  const usage = await monthlyUsage(actor);
  if (usage.used >= usage.limit) {
    throw new AiError(429, "This month's AI allowance for the office is used up.", 'AI_LIMIT_REACHED');
  }
  return usage;
}
