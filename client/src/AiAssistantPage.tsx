import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, History, MessageSquare, Send, Trash2, X } from 'lucide-react';
import { askAi, deleteAiHistoryItem, getAiHistory, getAiHistoryItem, getHealthStatus } from './api';
import type { AiAnswer, AiHistoryItem, LoginSession } from './types';

function errorMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error) {
    switch (failure.message) {
      case 'FORBIDDEN': return 'You do not have access to the AI Assistant.';
      case 'FEATURE_DISABLED': return 'The AI Assistant is currently disabled.';
      case 'AI_NOT_CONFIGURED': return 'The AI Assistant is not configured on the server. Ask an administrator to set the AI key.';
      case 'AI_SQL_REJECTED': return 'The AI could not produce a safe query for that question. Try rewording it.';
      case 'AI_SCOPE_REQUIRED': return 'This question needs to be scoped to your school(s). Try naming your school.';
      case 'AI_UPSTREAM_ERROR': return 'The AI service had an error. Please try again shortly.';
      case 'AI_HISTORY_NOT_FOUND': return 'That search is no longer available.';
      case 'QUESTION_REQUIRED': return 'Enter a question first.';
      default: return failure.message.startsWith('HTTP_') ? fallback : failure.message;
    }
  }
  return fallback;
}

function formatWhen(iso: string): string {
  // Server timestamps are UTC "YYYY-MM-DD HH:MM:SS". Parse as UTC, then format
  // relative to local time.
  const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function AiAssistantPage({ session }: { session: LoginSession }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [history, setHistory] = useState<AiHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [loadingHistoryItem, setLoadingHistoryItem] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [aiConfigured, setAiConfigured] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const list = await getAiHistory(session);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    getHealthStatus()
      .then((status) => { if (!cancelled) setAiConfigured(status.aiConfigured); })
      .catch(() => { if (!cancelled) setAiConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getAiHistory(session)
      .then((list) => { if (!cancelled) setHistory(list); })
      .catch((failure) => { if (!cancelled) setError(errorMessage(failure, 'Your recent searches could not be loaded.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session]);

  async function submit() {
    if (asking) return;
    const text = question.trim();
    if (!text) { setError('Enter a question first.'); return; }
    setAsking(true);
    setError('');
    setAnswer(null);
    try {
      const entry = await askAi(session, text);
      setAnswer(entry);
      // Keep the question in the textarea so the user can tweak it and ask a
      // similar follow-up without retyping.
      await loadHistory();
    } catch (failure) {
      setError(errorMessage(failure, 'The question could not be answered.'));
    } finally {
      setAsking(false);
    }
  }

  async function openHistory(id: string) {
    if (loadingHistoryItem) return;
    setLoadingHistoryItem(id);
    setError('');
    try {
      const entry = await getAiHistoryItem(session, id);
      setAnswer(entry);
    } catch (failure) {
      setError(errorMessage(failure, 'The saved answer could not be loaded.'));
    } finally {
      setLoadingHistoryItem(null);
    }
  }

  async function removeHistory(id: string) {
    if (deletingId) return;
    setDeletingId(id);
    setError('');
    try {
      await deleteAiHistoryItem(session, id);
      setHistory((prev) => prev.filter((item) => item.id !== id));
      if (answer?.id === id) setAnswer(null);
    } catch (failure) {
      setError(errorMessage(failure, 'The search could not be deleted.'));
    } finally {
      setDeletingId(null);
    }
  }

  const tableColumns = useMemo(() => (answer && answer.columns.length > 0 ? answer.columns : []), [answer]);
  const tableRows = useMemo(() => (answer ? answer.rows : []), [answer]);

  return <section className="reports-page" aria-labelledby="ai-title">
    <div className="reports-page-heading">
      <div>
        <p className="eyebrow">AI Assistant (Development Only)</p>
        <h2 id="ai-title">Ask about your data.</h2>
        <p className="reports-intro">Describe what you are looking for in plain language. The assistant generates safe, read-only SQL against your district data and shows the answer below.</p>
      </div>
    </div>

    {!aiConfigured && (
      <div className="notice error"><AlertCircle size={18} /><span>The AI Assistant is <strong>not configured</strong> on this server. Ask an administrator to set the AI endpoint, model, and key before you can use it.</span></div>
    )}

    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}

    <div className="search-row">
      <label className="search-field ai-question-field">
        <MessageSquare size={18} aria-hidden="true" />
        <span className="sr-only">Ask a question</span>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(); }}
          placeholder="e.g. Which schools have the most open positions? or Show me all vacant positions in a school for this year."
          rows={3}
          disabled={asking || !aiConfigured}
          aria-label="Ask a question"
        />
        {question && !asking && <button className="field-clear" onClick={() => setQuestion('')} aria-label="Clear question" title="Clear"><X size={15} /></button>}
      </label>
      <button className="export-button" disabled={asking || !aiConfigured} onClick={() => void submit()}>
        <Send size={16} />{asking ? 'Asking…' : 'Ask'}
      </button>
    </div>

    {asking && <div className="notice"><span className="loader" />Generating your answer…</div>}

    {answer && (
      <div className="ai-answer-card">
        <div className="ai-answer-heading">
          <strong>Answer</strong>
          <span className="ai-answer-meta">{answer.rowCount} row{answer.rowCount === 1 ? '' : 's'} · {formatWhen(answer.createdAt)}</span>
        </div>
        <p className="ai-answer-text">{answer.answer}</p>
        {tableColumns.length > 0 && tableRows.length > 0 && (
          <div className="report-table-wrap ai-result-table">
            <table className="report-table">
              <thead>
                <tr>{tableColumns.map((column) => <th key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {tableRows.slice(0, 50).map((row, idx) => (
                  <tr key={idx}>
                    {tableColumns.map((column) => (
                      <td key={column}>{row[column] === null || row[column] === undefined ? '' : String(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}

    <div className="ai-history-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Recent searches</p>
          <h3>Your history</h3>
        </div>
        <span className="result-count">{history.length}</span>
      </div>

      {loading ? <div className="empty-state"><span className="loader" />Loading</div> : history.length === 0 ? (
        <div className="empty-state"><History size={18} /><span>No saved searches yet.</span></div>
      ) : (
        <ul className="ai-history-list">
          {history.map((item) => (
            <li key={item.id} className="ai-history-item">
              <button
                className="ai-history-open"
                onClick={() => void openHistory(item.id)}
                disabled={loadingHistoryItem === item.id}
              >
                <span className="ai-history-question">{item.question}</span>
                <span className="ai-history-when">{formatWhen(item.createdAt)}</span>
              </button>
              <button
                className="icon-button subtle ai-history-delete"
                onClick={() => void removeHistory(item.id)}
                disabled={deletingId === item.id}
                aria-label="Delete search"
                title="Delete search"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  </section>;
}
