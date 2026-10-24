import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pool } from '../src/config/db.js';
import { CaseServiceError, assignStaffToCase } from '../src/services/caseService.js';

// These mocked service tests do not prove PostgreSQL executes the SQL as expected.
const admin = {
  user_id: '3ca4b66f-712b-4b4f-8e81-5b719c7dc58a',
  role: 'admin',
};
const caseId = '1cdd115e-0279-48b4-a795-1be1d5a50d0b';
const lawyerId = '8bf121a3-7cf3-4c44-8a56-65a05dd1c9b1';
const assistantId = '9bf121a3-7cf3-4c44-8a56-65a05dd1c9b2';

const assignmentSql = `
  INSERT INTO assigned_to (user_id, case_id, assignment_role)
  SELECT u.user_id, lc.case_id, r.role_name
  FROM app_users u
  JOIN roles r ON r.role_id = u.role_id
  JOIN legal_cases lc ON lc.case_id = $2
  LEFT JOIN lawyer_profiles lp ON lp.user_id = u.user_id
  WHERE u.user_id = $1
    AND u.status = 'active'
    AND (
      r.role_name = 'assistant'
      OR (
        r.role_name = 'lawyer'
        AND lp.license_status = 'active'
      )
    )
  RETURNING user_id, case_id, assignment_role, assigned_at, is_lead
`;

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function mockAssignmentQuery(t, handler) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, parameters = []) => {
    calls.push({ sql, parameters });
    return handler(sql, parameters);
  });
  return calls;
}

function assignment(userId, assignmentRole) {
  return {
    user_id: userId,
    case_id: caseId,
    assignment_role: assignmentRole,
    assigned_at: '2026-01-01T00:00:00.000Z',
    is_lead: false,
  };
}

function assertAssignmentQuery(calls, userId) {
  assert.equal(calls.length, 1);
  assert.equal(normalizeSql(calls[0].sql), normalizeSql(assignmentSql));
  assert.deepEqual(calls[0].parameters, [userId, caseId]);
}

test('assigns an eligible lawyer with the database-derived lawyer assignment role', async (t) => {
  const calls = mockAssignmentQuery(t, async () => ({
    rowCount: 1,
    rows: [assignment(lawyerId, 'lawyer')],
  }));

  const result = await assignStaffToCase(admin, caseId, { user_id: lawyerId });

  assert.deepEqual(result, assignment(lawyerId, 'lawyer'));
  assertAssignmentQuery(calls, lawyerId);
});

test('assigns an eligible assistant without requiring a lawyer profile', async (t) => {
  const calls = mockAssignmentQuery(t, async () => ({
    rowCount: 1,
    rows: [assignment(assistantId, 'assistant')],
  }));

  const result = await assignStaffToCase(admin, caseId, { user_id: assistantId });

  assert.deepEqual(result, assignment(assistantId, 'assistant'));
  assertAssignmentQuery(calls, assistantId);
});

test('does not accept a caller-supplied assignment role', async (t) => {
  const calls = mockAssignmentQuery(t, async () => {
    assert.fail('Invalid role input must fail before executing assignment SQL.');
  });

  await assert.rejects(
    assignStaffToCase(admin, caseId, {
      user_id: assistantId,
      assignment_role: 'lawyer',
    }),
    (error) => error instanceof CaseServiceError && error.status === 400
  );

  assert.equal(calls.length, 0);
});

test('returns not found and no assignment row for an inactive assistant', async (t) => {
  const calls = mockAssignmentQuery(t, async () => ({ rowCount: 0, rows: [] }));

  await assert.rejects(
    assignStaffToCase(admin, caseId, { user_id: assistantId }),
    (error) => error instanceof CaseServiceError
      && error.status === 404
      && error.message === 'Case or eligible staff member not found.'
  );

  assertAssignmentQuery(calls, assistantId);
});

test('returns not found and no assignment row for client or unsupported-role targets', async (t) => {
  for (const userId of [
    'b0f121a3-7cf3-4c44-8a56-65a05dd9b3a1',
    'c0f121a3-7cf3-4c44-8a56-65a05dd9b4c2',
  ]) {
    await t.test(`ineligible target ${userId}`, async (subtest) => {
      const calls = mockAssignmentQuery(subtest, async () => ({ rowCount: 0, rows: [] }));

      await assert.rejects(
        assignStaffToCase(admin, caseId, { user_id: userId }),
        (error) => error instanceof CaseServiceError && error.status === 404
      );

      assertAssignmentQuery(calls, userId);
    });
  }
});

test('returns not found and no assignment row when the case or eligible target is missing', async (t) => {
  const missingCaseCalls = mockAssignmentQuery(t, async () => ({ rowCount: 0, rows: [] }));

  await assert.rejects(
    assignStaffToCase(admin, caseId, { user_id: lawyerId }),
    (error) => error instanceof CaseServiceError && error.status === 404
  );

  assertAssignmentQuery(missingCaseCalls, lawyerId);
});

test('maps duplicate assignment database errors to a safe conflict', async (t) => {
  const duplicateError = Object.assign(new Error('duplicate assignment details'), {
    code: '23505',
  });
  const calls = mockAssignmentQuery(t, async () => {
    throw duplicateError;
  });

  await assert.rejects(
    assignStaffToCase(admin, caseId, { user_id: assistantId }),
    (error) => error instanceof CaseServiceError
      && error.status === 409
      && error.message === 'A record conflicts with existing data.'
      && !error.message.includes('duplicate assignment details')
  );

  assertAssignmentQuery(calls, assistantId);
});

test('maps database constraint violations without exposing database details', async (t) => {
  const constraintError = Object.assign(new Error('foreign key details'), {
    code: '23503',
  });
  const calls = mockAssignmentQuery(t, async () => {
    throw constraintError;
  });

  await assert.rejects(
    assignStaffToCase(admin, caseId, { user_id: lawyerId }),
    (error) => error instanceof CaseServiceError
      && error.status === 400
      && error.message === 'Case data violates a database constraint.'
      && !error.message.includes('foreign key details')
  );

  assertAssignmentQuery(calls, lawyerId);
});

test('propagates unrelated database failures rather than disguising them as success', async (t) => {
  const databaseError = new Error('connection failure');
  const calls = mockAssignmentQuery(t, async () => {
    throw databaseError;
  });

  await assert.rejects(
    assignStaffToCase(admin, caseId, { user_id: lawyerId }),
    (error) => error === databaseError
  );

  assertAssignmentQuery(calls, lawyerId);
});

test('rejects invalid actor, case ID, and user ID before issuing assignment SQL', async (t) => {
  const calls = mockAssignmentQuery(t, async () => {
    assert.fail('Invalid input must fail before executing assignment SQL.');
  });

  for (const [actor, requestCaseId, body, status] of [
    [{ ...admin, role: 'lawyer' }, caseId, { user_id: lawyerId }, 403],
    [admin, 'not-a-uuid', { user_id: lawyerId }, 400],
    [admin, caseId, { user_id: 'not-a-uuid' }, 400],
  ]) {
    await assert.rejects(
      assignStaffToCase(actor, requestCaseId, body),
      (error) => error instanceof CaseServiceError && error.status === status
    );
  }

  assert.equal(calls.length, 0);
});
