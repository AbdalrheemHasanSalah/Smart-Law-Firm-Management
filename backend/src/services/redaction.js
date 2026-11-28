import { query } from '../config/db.js';

/**
 * Redaction before any text leaves the server for an AI model.
 *
 * A redactor knows the people of a case (clients, opponents, the office team) with their ID
 * numbers, phones and emails, and swaps each for a placeholder: PERSON_1, ID_1, PHONE_1, EMAIL_1.
 * Phone numbers, ID-like numbers and email addresses that are not on record are caught by
 * pattern too, so a pasted document cannot leak them. The model only ever sees placeholders;
 * restore() puts the real values back into its answer on our server.
 *
 * Names are matched however their hamza, taa marbuta or alef maqsura were typed, with or without
 * diacritics, and with a leading و ف ب ل ك. A full name is matched, and so is every pair of its
 * words ("محمود أحمد النجار" → also "محمود النجار", "أحمد النجار"). A single word on its own is
 * not, because many names are ordinary words (صالح، أمين، جميل).
 */

const KINDS = { name: 'PERSON', id: 'ID', phone: 'PHONE', email: 'EMAIL' };
const PLACEHOLDER = /\b(PERSON|ID|PHONE|EMAIL)_(\d+)\b/g;
const MARKS = '[\\u064B-\\u0652\\u0670\\u0640]*';
const LETTER_CLASSES = {
  ا: '[اأإآٱ]', أ: '[اأإآٱ]', إ: '[اأإآٱ]', آ: '[اأإآٱ]', ٱ: '[اأإآٱ]',
  ه: '[هة]', ة: '[هة]',
  ي: '[يىئ]', ى: '[يىئ]', ئ: '[يىئ]',
  و: '[وؤ]', ؤ: '[وؤ]',
};
const NOT_WORD = '(?<![\\p{L}\\p{N}_])';
const END_WORD = '(?![\\p{L}\\p{N}_])';
const PREFIX = '(و|ف|ب|ل|ك|وب|ول|فب|فل)?';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Nine or more digits, Latin or Arabic-Indic, possibly split by spaces or dashes, with an optional +. */
const LONG_NUMBER = /(?<![\p{N}])\+?[0-9٠-٩](?:[\s-]?[0-9٠-٩]){8,14}(?![\p{N}])/gu;
const MIN_NAME_LENGTH = 3;

const toLatinDigits = (text) => text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
const digitsOf = (text) => toLatinDigits(text).replace(/\D/g, '');
/** Local mobiles start 05; international ones +970, +972 or 00970… */
const looksLikePhone = (digits, raw) => /^0(5|2|4|8|9)/.test(digits) || /^(00)?97[02]/.test(digits) || raw.trim().startsWith('+');

function namePattern(name) {
  const words = name.trim().split(/\s+/);
  const word = (part) =>
    [...part.replace(/[ً-ْٰـ]/g, '')]
      .map((letter) => (LETTER_CLASSES[letter] ?? letter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + MARKS)
      .join('');
  return words.map(word).join('\\s+');
}

/** The forms of a name to look for: the whole name, then each pair of its words. */
function nameForms(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const forms = new Set([words.join(' ')]);
  for (let first = 0; first < words.length; first += 1) {
    for (let second = first + 1; second < words.length; second += 1) forms.add(`${words[first]} ${words[second]}`);
  }
  // Longest first, so "محمود أحمد النجار" is replaced before "محمود النجار". A single word is
  // never a form on its own: too many names are also ordinary words.
  return [...forms]
    .filter((form) => form.includes(' ') && form.replace(/\s/g, '').length >= MIN_NAME_LENGTH)
    .sort((a, b) => b.length - a.length);
}

export function createRedactor() {
  const values = new Map(); // placeholder -> real value
  const byKey = new Map(); // kind + normalized value -> placeholder
  const counters = { name: 0, id: 0, phone: 0, email: 0 };
  const names = []; // { placeholder, pattern }

  const placeholderFor = (kind, key, display) => {
    const mapKey = `${kind}:${key}`;
    if (!byKey.has(mapKey)) {
      counters[kind] += 1;
      const placeholder = `${KINDS[kind]}_${counters[kind]}`;
      byKey.set(mapKey, placeholder);
      values.set(placeholder, display);
    }
    return byKey.get(mapKey);
  };

  const redactor = {
    /** Registers a person: their name, and any ID number, phone or email they have on record. */
    addPerson({ name, nationalId, phone, email } = {}) {
      if (typeof name === 'string' && name.trim().length >= MIN_NAME_LENGTH) {
        const placeholder = placeholderFor('name', name.trim(), name.trim());
        for (const form of nameForms(name)) {
          names.push({ placeholder, pattern: new RegExp(`${NOT_WORD}${PREFIX}${namePattern(form)}${END_WORD}`, 'gu') });
        }
        names.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
      }
      if (nationalId && digitsOf(String(nationalId)).length >= 5) placeholderFor('id', digitsOf(String(nationalId)), String(nationalId));
      if (phone && digitsOf(String(phone)).length >= 7) placeholderFor('phone', digitsOf(String(phone)), String(phone));
      if (email && String(email).includes('@')) placeholderFor('email', String(email).toLowerCase(), String(email));
      return redactor;
    },

    /** The text with every known and pattern-matched identifier replaced. */
    redact(text) {
      if (typeof text !== 'string' || !text) return text ?? '';
      let result = text.replace(EMAIL, (match) => placeholderFor('email', match.toLowerCase(), match));
      result = result.replace(LONG_NUMBER, (match) => {
        const digits = digitsOf(match);
        const known = byKey.get(`id:${digits}`) ?? byKey.get(`phone:${digits}`);
        if (known) return known;
        return looksLikePhone(digits, match) ? placeholderFor('phone', digits, match.trim()) : placeholderFor('id', digits, match.trim());
      });
      // Registered numbers shorter than the generic pattern (an old 7-digit phone, say).
      for (const [mapKey, placeholder] of byKey) {
        const [kind, key] = mapKey.split(/:(.*)/s);
        if ((kind === 'id' || kind === 'phone') && key.length < 9) {
          result = result.replace(new RegExp(`(?<![\\p{N}])${key.split('').join('[\\s-]?')}(?![\\p{N}])`, 'gu'), placeholder);
        }
      }
      for (const { placeholder, pattern } of names) result = result.replace(pattern, (_, prefix = '') => `${prefix ?? ''}${placeholder}`);
      return result;
    },

    /** Puts the real values back, in a string or anywhere inside an object or array. */
    restore(value) {
      if (typeof value === 'string') return value.replace(PLACEHOLDER, (match) => values.get(match) ?? match);
      if (Array.isArray(value)) return value.map((entry) => redactor.restore(entry));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactor.restore(entry)]));
      return value;
    },

    /** How many of each kind were replaced so far, to tell the user. */
    summary() {
      return { people: counters.name, ids: counters.id, phones: counters.phone, emails: counters.email };
    },
  };
  return redactor;
}

/**
 * A redactor that knows everyone on a case: its clients, its opponents and the office staff
 * assigned to it. The case must already be checked as visible to the actor.
 */
export async function redactorForCase(actor, caseId) {
  const [clients, opponents, team] = await Promise.all([
    query(
      `SELECT c.full_name_or_org, c.national_id, c.phone, c.email
         FROM involves i JOIN clients c ON c.client_id = i.client_id
        WHERE i.case_id = $1 AND c.office_id = $2`,
      [caseId, actor.office_id]
    ),
    query('SELECT o.full_name, o.national_id, o.phone FROM case_opponents o WHERE o.case_id = $1 AND o.office_id = $2', [caseId, actor.office_id]),
    query(
      `SELECT u.full_name, u.email
         FROM assigned_to a JOIN app_users u ON u.user_id = a.user_id
         JOIN legal_cases lc ON lc.case_id = a.case_id
        WHERE a.case_id = $1 AND lc.office_id = $2`,
      [caseId, actor.office_id]
    ),
  ]);
  const redactor = createRedactor();
  for (const row of clients.rows) redactor.addPerson({ name: row.full_name_or_org, nationalId: row.national_id, phone: row.phone, email: row.email });
  for (const row of opponents.rows) redactor.addPerson({ name: row.full_name, nationalId: row.national_id, phone: row.phone });
  for (const row of team.rows) redactor.addPerson({ name: row.full_name, email: row.email });
  if (actor.full_name) redactor.addPerson({ name: actor.full_name, email: actor.email });
  return redactor;
}

/** Told to every model that receives redacted text, so it keeps placeholders intact. */
export const PLACEHOLDER_INSTRUCTION =
  'Personal data has been replaced by placeholders such as PERSON_1, ID_1, PHONE_1 and EMAIL_1. Use them exactly as written wherever you refer to that person or value; never guess the real names or numbers.';
