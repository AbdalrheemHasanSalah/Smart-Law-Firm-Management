/** Encodes an i18n key + values into a Zod-compatible message string. */
export const i18nMessage = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}|${JSON.stringify(values)}` : key
