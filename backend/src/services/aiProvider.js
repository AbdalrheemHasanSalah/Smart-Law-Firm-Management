import Anthropic from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError, GoogleGenAI } from '@google/genai';

/**
 * The one place that talks to an AI model: Claude (Anthropic) when its key is set, otherwise
 * Gemini (Google), with Gemini's lighter model as a fallback when the main one is overloaded.
 * Hearing preparation, the case analysis tools and the support chat all go through here, and
 * every failure becomes an AiError with a stable public code the frontend translates:
 *
 *   AI_NOT_CONFIGURED (503)  no key, or the key was rejected
 *   AI_BUSY (429)            rate limited, overloaded or out of free quota
 *   AI_REFUSED (422)         the model declined (safety or policy)
 *   AI_FAILED (502)          any other failure, an unreadable or cut-off answer
 *
 * Callers redact personal data before calling (see redaction.js); nothing here looks at content.
 */

const DEFAULT_MODEL = 'claude-opus-5-5';
/** Gemini's fast model with a free tier on the Gemini Developer API. */
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
/** Lighter free model tried when the main one is overloaded or out of quota. */
const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
/** Lighter Gemini model first for chat: answers come back faster and it is rarely overloaded. */
const DEFAULT_CHAT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

export class AiError extends Error {
  constructor(status, message, publicCode) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    if (publicCode) this.publicCode = publicCode;
  }
}

let clientOverride = null;
let geminiOverride = null;
let cachedClient = null;
let cachedGemini = null;

/** Unit tests supply fake clients; nothing else should call these. */
export function setAiClientForTests(client) {
  clientOverride = client;
}
export function setGeminiClientForTests(client) {
  geminiOverride = client;
}

const hasAnthropicKey = (env) => Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
const hasGeminiKey = (env) => Boolean(env.GEMINI_API_KEY);

/**
 * Which model answers: AI_PROVIDER when its key is set, otherwise whichever key is present
 * (Claude first). null when neither is configured.
 */
export function aiProvider(env = process.env) {
  const anthropic = Boolean(clientOverride) || hasAnthropicKey(env);
  const gemini = Boolean(geminiOverride) || hasGeminiKey(env);
  if (env.AI_PROVIDER === 'gemini' && gemini) return 'gemini';
  if (env.AI_PROVIDER === 'anthropic' && anthropic) return 'anthropic';
  if (anthropic) return 'anthropic';
  if (gemini) return 'gemini';
  return null;
}

export function isAiConfigured(env = process.env) {
  return aiProvider(env) !== null;
}

/** The provider to use, or AI_NOT_CONFIGURED before any data is read or sent. */
export function requireProvider() {
  const provider = aiProvider();
  if (!provider) throw new AiError(503, 'The AI assistant is not configured on this server.', 'AI_NOT_CONFIGURED');
  return provider;
}

function claudeClient() {
  if (clientOverride) return clientOverride;
  cachedClient ??= new Anthropic();
  return cachedClient;
}

function geminiClient() {
  if (geminiOverride) return geminiOverride;
  cachedGemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return cachedGemini;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError(502, 'The AI answer could not be read. Try again.', 'AI_FAILED');
  }
}

function claudeFailure(error) {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiError(503, 'The AI assistant credentials were rejected.', 'AI_NOT_CONFIGURED');
  }
  if (error instanceof Anthropic.RateLimitError) return new AiError(429, 'The AI assistant is busy. Try again in a minute.', 'AI_BUSY');
  if (error instanceof Anthropic.APIError) return new AiError(502, 'The AI assistant could not answer. Try again later.', 'AI_FAILED');
  return error;
}

/** Finish reasons with which Gemini stops because its safety or policy filters blocked the answer. */
const GEMINI_BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

/** Overloaded (503) or out of free quota (429): worth trying the lighter model. */
const geminiBusy = (error) => error instanceof GeminiApiError && (error.status === 503 || error.status === 429);

function geminiFailure(error) {
  if (!(error instanceof GeminiApiError)) return error;
  if ((error.status === 400 && /api key/i.test(error.message)) || error.status === 401 || error.status === 403) {
    return new AiError(503, 'The Gemini API key was rejected.', 'AI_NOT_CONFIGURED');
  }
  if (error.status === 429 || error.status === 503) {
    return new AiError(429, 'Gemini is busy or the free quota is used up. Try again in a minute.', 'AI_BUSY');
  }
  return new AiError(502, 'Gemini could not answer. Try again later.', 'AI_FAILED');
}

/** Asks Gemini with the main model, then the lighter one when the main one is busy. */
async function withGeminiFallback(primary, fallback, request) {
  try {
    try {
      return { model: primary, response: await request(primary) };
    } catch (error) {
      if (!geminiBusy(error) || !fallback || fallback === primary) throw error;
      return { model: fallback, response: await request(fallback) };
    }
  } catch (error) {
    throw geminiFailure(error);
  }
}

const geminiBlocked = (response) =>
  Boolean(response.promptFeedback?.blockReason) || GEMINI_BLOCKED.has(response.candidates?.[0]?.finishReason);

async function claudeJson({ system, user, schema, effort, maxTokens }) {
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  let response;
  try {
    response = await claudeClient().beta.messages.create({
      model,
      max_tokens: maxTokens,
      // A safety decline on the main model is retried on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
  } catch (error) {
    throw claudeFailure(error);
  }
  if (response.stop_reason === 'refusal') throw new AiError(422, 'The AI assistant declined this request.', 'AI_REFUSED');
  if (response.stop_reason === 'max_tokens') {
    throw new AiError(502, 'The AI answer was cut off. Try again with a shorter text or a narrower focus.', 'AI_FAILED');
  }
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  return { data: parseJson(text), model: response.model };
}

export async function geminiJson({ system, user, schema, maxTokens }) {
  const primary = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL;
  const { model, response } = await withGeminiFallback(primary, fallback, (name) =>
    geminiClient().models.generateContent({
      model: name,
      contents: user,
      config: {
        systemInstruction: system,
        // JSON that follows the same schema as Claude's answer.
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        maxOutputTokens: maxTokens,
      },
    })
  );
  if (geminiBlocked(response)) throw new AiError(422, 'The AI assistant declined this request.', 'AI_REFUSED');
  if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    throw new AiError(502, 'The AI answer was cut off. Try again with a shorter text or a narrower focus.', 'AI_FAILED');
  }
  return { data: parseJson(response.text ?? ''), model: response.modelVersion || model };
}

/**
 * One structured answer that follows `schema`, from the configured provider.
 * Returns { data, model, provider }.
 */
export async function askForJson({ system, user, schema, effort = 'medium', maxTokens = 16000 }) {
  const provider = requireProvider();
  const answer = provider === 'gemini'
    ? await geminiJson({ system, user, schema, maxTokens })
    : await claudeJson({ system, user, schema, effort, maxTokens });
  return { ...answer, provider };
}

/**
 * One short text reply from the configured provider. `history` is [{ role: 'user' | 'assistant', text }],
 * oldest first, ending with the user's message.
 */
export async function chatWithAi(system, history) {
  const provider = requireProvider();
  if (provider === 'gemini') {
    const primary = process.env.SUPPORT_GEMINI_MODEL || DEFAULT_CHAT_GEMINI_MODEL;
    const fallback = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const { response } = await withGeminiFallback(primary, fallback, (name) =>
      geminiClient().models.generateContent({
        model: name,
        contents: history.map((turn) => ({ role: turn.role === 'assistant' ? 'model' : 'user', parts: [{ text: turn.text }] })),
        config: { systemInstruction: system, maxOutputTokens: 1024 },
      })
    );
    if (geminiBlocked(response)) throw new AiError(422, 'The assistant declined.', 'AI_REFUSED');
    return (response.text ?? '').trim();
  }

  let response;
  try {
    response = await claudeClient().messages.create({
      model: process.env.SUPPORT_AI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      // Short answers about the site do not need deep thinking.
      output_config: { effort: 'low' },
      system,
      messages: history.map((turn) => ({ role: turn.role, content: turn.text })),
    });
  } catch (error) {
    throw claudeFailure(error);
  }
  if (response.stop_reason === 'refusal') throw new AiError(422, 'The assistant declined.', 'AI_REFUSED');
  return response.content.filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
}
