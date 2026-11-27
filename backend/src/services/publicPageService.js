import { auditLater } from './auditService.js';
import { assertActor, assertBody, execute, invalid, notFound, OfficeFinanceError, text } from './financeInput.js';
import { officeCondition } from './officeScope.js';
import { createFileStore, detectReceiptType } from './receiptStorage.js';

/**
 * The office's public page at /o/<slug>: its name and contact details (from the office record),
 * what the administrator writes about it, its practice areas, opening hours, a map link, a logo,
 * and the lawyers the administrator chose to list (name and job title only).
 *
 * Only a published page of an active office can be seen, by anyone, without signing in.
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Paths of the app itself, so a page link never looks like one of them.
const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'login', 'office', 'platform', 'portal', 'register', 'www']);
const MAX_PRACTICE_AREAS = 12;
const logos = createFileStore({ folder: 'office-logos', noun: 'logo', maxBytes: 2 * 1024 * 1024 });

const PAGE_FIELDS = ['slug', 'is_published', 'tagline', 'about', 'practice_areas', 'whatsapp', 'working_hours', 'map_url'];

export function normalizeSlug(value) {
  if (typeof value !== 'string') invalid('slug is required.');
  const slug = value.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 60 || !SLUG_PATTERN.test(slug)) {
    invalid('slug must be 3 to 60 Latin letters, digits and single hyphens.');
  }
  if (RESERVED_SLUGS.has(slug)) throw new OfficeFinanceError(409, 'This link is reserved.', 'SLUG_TAKEN');
  return slug;
}

const publicPage = (row) => ({
  slug: row.slug,
  is_published: row.is_published,
  tagline: row.tagline,
  about: row.about,
  practice_areas: row.practice_areas ?? [],
  whatsapp: row.whatsapp,
  working_hours: row.working_hours,
  map_url: row.map_url,
  has_logo: Boolean(row.has_logo),
  updated_at: row.updated_at,
});

/** The administrator's own page settings, or null before the page is first saved. */
export async function getOwnPublicPage(actor) {
  assertActor(actor, ['admin']);
  const parameters = [];
  const office = officeCondition(actor, parameters, 'p');
  const result = await execute(
    `SELECT p.*, (p.logo_key IS NOT NULL) AS has_logo FROM office_public_pages p WHERE ${office}`,
    parameters
  );
  return { page: result.rowCount ? publicPage(result.rows[0]) : null };
}

export async function savePublicPage(actor, body) {
  assertActor(actor, ['admin']);
  assertBody(body, PAGE_FIELDS);
  const slug = normalizeSlug(body.slug);
  if (typeof body.is_published !== 'boolean') invalid('is_published must be true or false.');
  const areas = body.practice_areas ?? [];
  if (!Array.isArray(areas) || areas.length > MAX_PRACTICE_AREAS) invalid(`practice_areas may list at most ${MAX_PRACTICE_AREAS} areas.`);
  const practiceAreas = [...new Set(areas.map((area) => text(area, 'practice_areas', 60)).filter(Boolean))];
  const mapUrl = text(body.map_url, 'map_url', 500);
  if (mapUrl) {
    let parsed;
    try {
      parsed = new URL(mapUrl);
    } catch {
      invalid('map_url must be a link.');
    }
    if (parsed.protocol !== 'https:') invalid('map_url must be an https link.');
  }
  const whatsapp = text(body.whatsapp, 'whatsapp', 30);
  if (whatsapp && !/^\+?[0-9 ]{7,20}$/.test(whatsapp)) invalid('whatsapp must be a phone number.');
  const parameters = [
    slug, body.is_published, text(body.tagline, 'tagline', 200), text(body.about, 'about', 4000), practiceAreas,
    whatsapp, text(body.working_hours, 'working_hours', 300), mapUrl,
  ];
  officeCondition(actor, parameters, 'office');
  let result;
  try {
    result = await execute(
      `INSERT INTO office_public_pages (slug, is_published, tagline, about, practice_areas, whatsapp, working_hours, map_url, office_id)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)
       ON CONFLICT (office_id) DO UPDATE SET
         slug = EXCLUDED.slug, is_published = EXCLUDED.is_published, tagline = EXCLUDED.tagline, about = EXCLUDED.about,
         practice_areas = EXCLUDED.practice_areas, whatsapp = EXCLUDED.whatsapp, working_hours = EXCLUDED.working_hours,
         map_url = EXCLUDED.map_url, updated_at = NOW()
       RETURNING *, (logo_key IS NOT NULL) AS has_logo`,
      parameters
    );
  } catch (error) {
    // The only unique value that can clash is the link, used by another office.
    if (error?.publicCode === 'DUPLICATE') throw new OfficeFinanceError(409, 'This link is already used by another office.', 'SLUG_TAKEN');
    throw error;
  }
  auditLater(actor, { action: 'public_page_saved', entityType: 'office', entityId: actor.office_id, details: { values: { slug, is_published: body.is_published } } });
  return { page: publicPage(result.rows[0]) };
}

/** Sets the logo: a PNG or JPEG of at most 2 MB. The page must have been saved first. */
export async function attachLogo(actor, request) {
  assertActor(actor, ['admin']);
  const buffer = await logos.readBody(request);
  const type = detectReceiptType(buffer);
  if (!type || type.extension === 'pdf') throw new OfficeFinanceError(415, 'The logo must be a PNG or JPG image.', 'VALIDATION');
  const key = await logos.save(buffer);
  const parameters = [key];
  const office = officeCondition(actor, parameters, 'p');
  let previous;
  try {
    const result = await execute(
      `UPDATE office_public_pages AS p SET logo_key = $1, updated_at = NOW()
         FROM office_public_pages old
        WHERE old.office_id = p.office_id AND ${office}
       RETURNING old.logo_key AS previous_key`,
      parameters
    );
    if (!result.rowCount) invalid('Save the page before adding its logo.');
    previous = result.rows[0].previous_key;
  } catch (error) {
    await logos.remove(key);
    throw error;
  }
  if (previous) await logos.remove(previous);
  return { has_logo: true };
}

/* ───────────── what visitors see ───────────── */

const PUBLISHED = `
  FROM office_public_pages p
  JOIN law_offices o ON o.office_id = p.office_id AND o.status = 'active'
  WHERE p.slug = $1 AND p.is_published`;

/** A published page of an active office, as visitors see it, or 404. */
export async function getPublishedPage(slugValue) {
  if (typeof slugValue !== 'string' || !SLUG_PATTERN.test(slugValue.toLowerCase()) || slugValue.length > 60) notFound('Page');
  const slug = slugValue.toLowerCase();
  const result = await execute(
    `SELECT p.*, (p.logo_key IS NOT NULL) AS has_logo, o.office_id, o.name, o.phone, o.email, o.city, o.address ${PUBLISHED}`,
    [slug]
  );
  if (!result.rowCount) notFound('Page');
  const row = result.rows[0];
  const lawyers = await execute(
    `SELECT u.full_name, sp.job_title
       FROM staff_profiles sp
       JOIN office_memberships m ON m.office_id = sp.office_id AND m.user_id = sp.user_id AND m.status = 'active'
       JOIN app_users u ON u.user_id = sp.user_id AND u.status = 'active'
      WHERE sp.office_id = $1 AND sp.show_on_public_page
      ORDER BY u.full_name`,
    [row.office_id]
  );
  const { is_published: _published, updated_at: _updated, ...page } = publicPage(row);
  return {
    page: {
      ...page,
      office: { name: row.name, phone: row.phone, email: row.email, city: row.city, address: row.address },
      lawyers: lawyers.rows.map((lawyer) => ({ full_name: lawyer.full_name, job_title: lawyer.job_title })),
    },
  };
}

export async function readPublishedLogo(slugValue) {
  if (typeof slugValue !== 'string' || !SLUG_PATTERN.test(slugValue.toLowerCase())) notFound('Logo');
  const result = await execute(`SELECT p.logo_key ${PUBLISHED}`, [slugValue.toLowerCase()]);
  if (!result.rows[0]?.logo_key) notFound('Logo');
  return logos.read(result.rows[0].logo_key);
}

/** The office behind a published page, for the consultation form. */
export async function publishedOfficeId(slugValue) {
  if (typeof slugValue !== 'string' || !SLUG_PATTERN.test(slugValue.toLowerCase())) notFound('Page');
  const result = await execute(`SELECT p.office_id ${PUBLISHED}`, [slugValue.toLowerCase()]);
  if (!result.rowCount) notFound('Page');
  return result.rows[0].office_id;
}
