import { getAiConfig, isAiConfigured } from '../config.js';
import { schemaForAi } from './schema.js';
import { validateAiSql } from '../reports-sql.js';
import { bindNamedParam } from '../reports-sql.js';
import { query } from '../db.js';
import type { AiHistoryEntry, Repositories } from '../repositories/contracts.js';
import { REPORT_ROW_CAP, nowIso } from '../reports-sql.js';

// Error codes surfaced to the client via repoErrorToStatus in app.ts.
export const AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED';
export const AI_UPSTREAM_ERROR = 'AI_UPSTREAM_ERROR';
export const AI_SQL_REJECTED = 'AI_SQL_REJECTED';
export const QUESTION_REQUIRED = 'QUESTION_REQUIRED';

/** The transit-429/empty-response/5xx errors are retried before surfacing to the caller. */
const AI_RETRIES = 3;

/**
 * Call an OpenAI-compatible chat endpoint. The operator supplies the base URL,
 * model, and key via env; we never pass the key to the browser.
 *
 * The upstream provider is occasionally flaky, returning a non-2xx status or an
 * empty `message.content`. Because individual calls are independent, we retry on
 * those transient failures (up to AI_RETRIES attempts) with a short backoff so the
 * user is not shown a 502 for a spurious upstream blip.
 */
async function chat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { baseUrl, model, apiKey, maxTokens, requestTimeoutMs } = getAiConfig();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= AI_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.4,
          max_tokens: maxTokens
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(
          `[ai] upstream ${response.status} for model=${model} (attempt ${attempt}/${AI_RETRIES}): ${body.slice(0, 600)}`
        );
        // 429 (rate limit) and 5xx are transient; a 4xx like 400/401 never fixes itself.
        const retriable = response.status === 429 || response.status >= 500;
        if (!retriable) {
          throw Object.assign(
            new Error(`AI upstream error ${response.status}: ${body.slice(0, 400)}`),
            { code: AI_UPSTREAM_ERROR }
          );
        }
        lastError = new Error(`AI upstream error ${response.status}: ${body.slice(0, 400)}`);
        await sleep(300 * attempt);
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) return content;

      // Empty content: retry a couple times, then surface it.
      console.error(
        `[ai] empty response for model=${model} (attempt ${attempt}/${AI_RETRIES}); ${JSON.stringify(data).slice(0, 300)}`
      );
      lastError = new Error('AI returned an empty response');
      await sleep(300 * attempt);
      if (attempt === AI_RETRIES) break;
    } catch (error) {
      // Only reached on a fetch network/abort throw OR a thrown non-retriable
      // error carrying our string `code`. An AbortError is a DOMException whose
      // `code` is numeric (20), so we must NOT gate on the raw `.code` — only
      // our own AI_UPSTREAM_ERROR string marks a non-retriable failure. Network
      // + abort errors are retried and, if exhausted, surface as AI_UPSTREAM_ERROR.
      if ((error as { code?: string })?.code === AI_UPSTREAM_ERROR) throw error;
      lastError = error;
      if (attempt === AI_RETRIES) {
        throw Object.assign(
          new Error(error instanceof Error ? error.message : 'AI request failed'),
          { code: AI_UPSTREAM_ERROR }
        );
      }
      await sleep(300 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw Object.assign(
    new Error((lastError instanceof Error ? lastError.message : 'AI request failed') ?? 'AI request failed'),
    { code: AI_UPSTREAM_ERROR }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip a fenced markdown block (```sql ... ``` or ``` ... ```) if present. */
function stripFence(text: string): string {
  const match = text.match(/```(?:sql|SQL)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  return text.trim();
}

/** Extract a believable answer from the human-readable response (not the SQL). */
function stripCodeBlock(text: string): string {
  // Return everything after a SQL block, else the whole message, so the answer
  // reads like prose rather than echoing machine output.
  const fence = text.match(/```(?:sql|SQL)?\s*([\s\S]*?)```/);
  if (!fence) return text.trim();
  const after = text.slice(fence.index! + fence[0].length).trim();
  return after || text.trim();
}

export type AskOptions = {
  userId: string;
  question: string;
  schoolIds: string[];
  scoped: boolean;
  organization: string | null;
  repositories: Repositories;
};

/**
 * Two-model-call pipeline: generate SQL, validate it server-side, run it, then
 * format a natural-language answer. The answer + result rows are persisted to
 * the caller's per-user ask history.
 */
export async function ask(options: AskOptions): Promise<AiHistoryEntry> {
  const { userId, question, schoolIds, scoped, organization, repositories } = options;

  if (!isAiConfigured()) {
    const err = new Error('AI is not configured. Set AI_BASE_URL, AI_MODEL, and AI_API_KEY.');
    (err as { code?: string }).code = AI_NOT_CONFIGURED;
    throw err;
  }

  // ---- Call #1: SQL generator ----
  const trimmed = question.trim();
  if (!trimmed) {
    const err = new Error('Question is required.');
    (err as { code?: string }).code = QUESTION_REQUIRED;
    throw err;
  }

  const scopeInstruction = scoped
    ? `IMPORTANT: This data belongs to specific school(s). Your query MUST filter on the "organization" column using the ':organization' placeholder (e.g. WHERE organization = :organization). You may also use :school_ids as a comma-separated list. Never return data from other schools.`
    : `This caller can view all schools, so cross-school aggregates are allowed. Use :organization only if you truly need a single school.`;

  const sqlSystem = `You are a SQL expert for a small school district. You turn a natural-language question into a single read-only MySQL SELECT statement.

Schema:
${schemaForAi}

Rules:
- Output ONLY a single MySQL SELECT statement with no surrounding commentary, no explanation, and no leading/trailing fences.
- The statement MUST be read-only. Never use INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/TRUNCATE/GRANT/REVOKE, stored procedures, or stack the statement with semicolons.
- Never use dynamic SQL (PREPARE/EXECUTE), INFORMATION_SCHEMA, or functions like LOAD_FILE/SLEEP/BENCHMARK.
- Reference columns exactly as they appear in the schema. Never invent columns.
- If a question spans multiple tables, use the documented join keys.
- Dates are stored as strings in YYYY-MM-DD format (or with a time). Compare using the same format.
- Always add a LIMIT to cap the result (use at most ${REPORT_ROW_CAP} rows).
- ${scopeInstruction}
- Do not use ":organization" or ":school_ids" for anything other than the school filter.`;

  const sqlText = await chat(sqlSystem, trimmed);
  const sql = stripFence(sqlText);

  // ---- Server-side validation (single choke point) ----
  const validation = validateAiSql(sql, scoped);
  if (!validation.ok) {
    const err = new Error(`AI generated unsafe SQL: ${validation.error}`);
    (err as { code?: string }).code = AI_SQL_REJECTED;
    (err as { errorCode?: string }).errorCode = validation.error;
    throw err;
  }

  // ---- Bind named params, then execute ---- 
  let executed: Record<string, unknown>[];
  try {
    if (scoped) {
      // Scoped caller: bind :organization (single) or :school_ids (list).
      let bound = { text: sql, params: [] as (string | number | null)[] };
      if (/:organization\b/.test(sql)) {
        bound = bindNamedParam(sql, 'organization', organization ?? schoolIds[0] ?? '');
      } else if (/:school_ids\b/.test(sql)) {
        bound = bindNamedParam(sql, 'school_ids', schoolIds.join(', '));
      }
      executed = await query(bound.text, bound.params);
    } else {
      executed = await query(sql);
    }
  } catch (error) {
    // A runtime DB error (e.g. unknown column from a stale schema reference) is
    // surfaced as a user-facing 400 instead of a bare 500. Preserve the MySQL
    // error code (e.g. ER_BAD_FIELD_ERROR) so it can be logged, and map it to
    // AI_SQL_REJECTED so the client can retry with a different phrasing.
    const message = (error as Error)?.message ?? String(error);
    const err = new Error(`The generated query could not be run: ${message}`);
    (err as { code?: string }).code = AI_SQL_REJECTED;
    (err as { errorCode?: string }).errorCode = (error as { code?: string })?.code ?? 'DB_EXECUTION_FAILED';
    throw err;
  }
  executed = executed.slice(0, REPORT_ROW_CAP);

  const columns = executed.length > 0 ? Object.keys(executed[0]) : [];
  const rowCount = executed.length;

  // ---- Call #2: answer formatter ----
  const answerSystem = `You are a helpful data assistant. You are given a school-district question, the SQL that answered it, and the resulting rows. Write a concise, well-structured, friendly natural-language answer that directly addresses the question. Do not mention that SQL was used, and do not expose the raw SQL. Use the number of rows and the column names to describe the data. Keep it short (a few short sentences or bullets) and accurate to the returned rows. If the result set is empty, say so plainly. If no data was returned, explain that no matching records were found.`;

  const answerRaw = await chat(answerSystem, `Question: ${trimmed}\n\nSQL:\n${sql}\n\nRows (${rowCount}):\n${JSON.stringify(executed.slice(0, 50))}`);
  const answer = stripCodeBlock(answerRaw);

  // Persist the ask so the client can show "recent searches". If the
  // ask_history table has not been created yet (DBA migration pending), the
  // answer is still returned — history is simply not saved.
  try {
    const entry = await repositories.aiHistory.create({
      userId,
      question: trimmed,
      answer,
      sql,
      rowCount,
      columns,
      rows: executed,
      model: getAiConfig().model
    });
    return entry;
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    return {
      id: '',
      userId,
      question: trimmed,
      answer,
      sql,
      rowCount,
      columns,
      rows: executed,
      model: getAiConfig().model,
      createdAt: nowIso()
    };
  }
}

/**
 * True when the error means the table isn't usable yet — either it doesn't
 * exist (MySQL 1146 / SQLite "no such table") or the app user has no grants
 * on it (MySQL 1142). Lets the AI Assistant keep working (history unsaved)
 * before the DBA has created ask_history.
 */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string; errno?: number } | null)?.code;
  const errno = (error as { errno?: number } | null)?.errno;
  const message = error instanceof Error ? error.message : '';
  return (
    code === 'ER_NO_SUCH_TABLE' ||
    code === 'ER_TABLEACCESS_DENIED_ERROR' ||
    errno === 1146 ||
    errno === 1142 ||
    /no such table/i.test(message) ||
    /command denied to user .* for table/i.test(message)
  );
}

export async function listHistory(
  repositories: Repositories,
  userId: string,
  limit = 20
) {
  try {
    return await repositories.aiHistory.list(userId, limit);
  } catch (error) {
    // History table not created yet (DBA migration pending) -> empty list.
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export async function getHistory(
  repositories: Repositories,
  id: string,
  userId: string
): Promise<AiHistoryEntry | null> {
  try {
    return await repositories.aiHistory.getById(id, userId);
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

export async function deleteHistory(
  repositories: Repositories,
  id: string,
  userId: string
): Promise<boolean> {
  try {
    return await repositories.aiHistory.delete(id, userId);
  } catch (error) {
    if (isMissingTableError(error)) return false;
    throw error;
  }
}
