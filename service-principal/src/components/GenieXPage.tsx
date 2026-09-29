import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configProblems, genieWorkspaceUrl, getConfig } from "../lib/config";
import {
  BrokerApiError,
  continueChat,
  createBrokerSession,
  getChatMessage,
  getQueryResult,
  getVisualization,
  startChat,
  streamResearch,
} from "../lib/headlessGenie";
import { getVaultSession } from "../lib/veeva";
import type { GenieExperienceMode } from "../types/config";
import type {
  AgentOutputItem,
  AgentResponse,
  BrokerSession,
  GenieAttachment,
  GenieMessage,
  QueryResultResponse,
} from "../types/genie";

type ConnectionPhase = "configuration" | "connecting" | "ready" | "error";
type MessageState = "working" | "complete" | "error";

interface TableData {
  columns: string[];
  rows: string[][];
  totalRows?: number;
  truncated?: boolean;
}

interface QueryCard {
  attachmentId: string;
  title: string;
  description?: string;
  sql?: string;
  table?: TableData;
  loading: boolean;
  error?: string;
}

interface VisualCard {
  attachmentId: string;
  title: string;
  url?: string;
  loading: boolean;
  error?: string;
}

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: GenieExperienceMode;
  state: MessageState;
  status?: string;
  queries?: QueryCard[];
  visuals?: VisualCard[];
  researchOutputs?: string[];
  sql?: string[];
  suggestions?: string[];
}

const suggestions = [
  "Show the patient count and median observed survival by ECOG performance status.",
  "What is the median observed overall survival for deceased Stage IV patients, broken down by primary driver?",
  "What is the average total cost of care by primary driver among advanced-stage patients?",
];

const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"]);

export function GenieXPage() {
  const [config] = useState(() => getConfig());
  const problems = useMemo(() => configProblems(config), [config]);
  const [phase, setPhase] = useState<ConnectionPhase>(problems.length ? "configuration" : "connecting");
  const [connectionError, setConnectionError] = useState("");
  const [session, setSession] = useState<BrokerSession>();
  const [mode, setMode] = useState<GenieExperienceMode>(config.defaultMode);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string>();
  const [researchConversationId, setResearchConversationId] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const visualUrlsRef = useRef(new Set<string>());
  const sessionRef = useRef<BrokerSession | undefined>(undefined);
  const connectionInFlightRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => () => {
    abortRef.current?.abort();
    for (const url of visualUrlsRef.current) URL.revokeObjectURL(url);
  }, []);

  const updateMessage = useCallback((id: string, update: (message: UiMessage) => UiMessage) => {
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message));
  }, []);

  const connect = useCallback(async (background = false) => {
    if (connectionInFlightRef.current) return;
    connectionInFlightRef.current = true;
    if (!background) {
      setPhase("connecting");
      setConnectionError("");
    }
    let vaultSession: Awaited<ReturnType<typeof getVaultSession>> | undefined;
    try {
      vaultSession = await getVaultSession();
      const nextSession = await createBrokerSession(config.authBrokerBaseUrl, vaultSession);
      sessionRef.current = nextSession;
      setSession(nextSession);
      setConnectionError("");
      setPhase("ready");
    } catch (error) {
      const current = sessionRef.current;
      if (!background || !current || Date.parse(current.expiresAt) <= Date.now()) {
        sessionRef.current = undefined;
        setSession(undefined);
        setConnectionError(humanizeConnectionError(error));
        setPhase("error");
      }
    } finally {
      if (vaultSession) vaultSession.sessionId = "";
      connectionInFlightRef.current = false;
    }
  }, [config.authBrokerBaseUrl]);

  useEffect(() => {
    if (problems.length > 0) return;
    const timer = window.setTimeout(() => void connect(), 0);
    return () => window.clearTimeout(timer);
  }, [connect, problems.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (current && Date.parse(current.expiresAt) - Date.now() <= 3 * 60_000) {
        void connect(true);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [connect]);

  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    for (const url of visualUrlsRef.current) URL.revokeObjectURL(url);
    visualUrlsRef.current.clear();
    setMessages([]);
    setChatConversationId(undefined);
    setResearchConversationId(undefined);
    setBusy(false);
  }, []);

  const handleApiError = useCallback((assistantId: string, error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const description = humanizeApiError(error);
    updateMessage(assistantId, (message) => ({
      ...message,
      content: description,
      state: "error",
      status: undefined,
    }));
    if (error instanceof BrokerApiError && ["session_expired", "missing_session"].includes(error.code)) {
      sessionRef.current = undefined;
      setSession(undefined);
      setConnectionError("Your secure session expired. Vault CRM is reconnecting automatically.");
      setPhase("connecting");
      void connect();
    }
  }, [connect, updateMessage]);

  const runChat = useCallback(async (
    content: string,
    assistantId: string,
    activeSession: BrokerSession,
  ) => {
    let conversationId = chatConversationId;
    let messageId: string | undefined;

    if (!conversationId) {
      const started = await startChat(config.authBrokerBaseUrl, activeSession.sessionToken, content);
      conversationId = started.conversation_id
        ?? started.conversation?.conversation_id
        ?? started.conversation?.id
        ?? started.message?.conversation_id;
      messageId = started.message_id ?? started.message?.message_id ?? started.message?.id;
      if (conversationId) setChatConversationId(conversationId);
    } else {
      const created = await continueChat(
        config.authBrokerBaseUrl,
        activeSession.sessionToken,
        conversationId,
        content,
      );
      messageId = created.message_id ?? created.id;
    }

    if (!conversationId || !messageId) throw new Error("genie_missing_conversation");
    let completed: GenieMessage | undefined;
    let waitMs = 1_200;
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const message = await getChatMessage(
        config.authBrokerBaseUrl,
        activeSession.sessionToken,
        conversationId,
        messageId,
      );
      updateMessage(assistantId, (current) => ({
        ...current,
        status: chatStatusLabel(message.status),
      }));
      if (message.status && terminalStatuses.has(message.status)) {
        completed = message;
        break;
      }
      await delay(waitMs);
      waitMs = Math.min(Math.round(waitMs * 1.45), 5_000);
    }
    if (!completed) throw new Error("genie_timed_out");
    if (completed.status !== "COMPLETED") {
      throw new Error(completed.error?.error || completed.error?.type || `genie_${completed.status?.toLowerCase()}`);
    }
    await hydrateChatMessage(completed, assistantId, activeSession, config.authBrokerBaseUrl, updateMessage, visualUrlsRef.current);
  }, [chatConversationId, config.authBrokerBaseUrl, updateMessage]);

  const runResearch = useCallback(async (
    content: string,
    assistantId: string,
    activeSession: BrokerSession,
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    let finalResponse: AgentResponse | undefined;
    let streamError: string | undefined;

    await streamResearch(
      config.authBrokerBaseUrl,
      activeSession.sessionToken,
      content,
      researchConversationId,
      (event) => {
        const response = event.response;
        const conversationId = response?.conversation_id;
        if (conversationId) {
          setResearchConversationId(conversationId);
        }
        const type = event.type ?? "";
        if (type === "response.completed" && response) finalResponse = response;
        if (type === "response.failed" && response) {
          finalResponse = response;
          streamError = response.error?.message || response.error?.code || "Research response failed";
        }
        updateMessage(assistantId, (current) => ({
          ...current,
          status: researchStatusLabel(type, event.item),
        }));
      },
      controller.signal,
    );

    if (streamError) throw new Error(streamError);
    if (!finalResponse || finalResponse.status !== "completed") throw new Error("research_stream_incomplete");
    const rendered = renderAgentResponse(finalResponse);
    updateMessage(assistantId, (current) => ({
      ...current,
      content: rendered.answer,
      researchOutputs: rendered.outputs,
      sql: rendered.sql,
      state: "complete",
      status: undefined,
    }));
  }, [config.authBrokerBaseUrl, researchConversationId, updateMessage]);

  const send = useCallback(async (override?: string) => {
    const content = (override ?? draft).trim();
    if (!content || !session || busy) return;
    const activeMode = mode;
    const userId = createId("user");
    const assistantId = createId("assistant");
    setDraft("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content, mode: activeMode, state: "complete" },
      {
        id: assistantId,
        role: "assistant",
        content: activeMode === "research" ? "Starting a deeper analysis…" : "Working on your question…",
        mode: activeMode,
        state: "working",
        status: activeMode === "research" ? "Planning research" : "Reading governed data",
      },
    ]);
    try {
      if (activeMode === "research") await runResearch(content, assistantId, session);
      else await runChat(content, assistantId, session);
    } catch (error) {
      handleApiError(assistantId, error);
    } finally {
      setBusy(false);
      abortRef.current = undefined;
    }
  }, [busy, draft, handleApiError, mode, runChat, runResearch, session]);

  const changeMode = (nextMode: GenieExperienceMode) => {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
  };

  const status = connectionStatus(phase, busy, mode);
  const connected = phase === "ready" && Boolean(session);

  return (
    <main className="xpage">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="spark" aria-hidden="true"><SparkIcon /></span>
          <span className="space-heading">
            <small>Genie</small>
            <strong>{config.displayName}</strong>
          </span>
        </div>
        <span className="host-badge">Veeva Vault CRM</span>
        <span className="host-badge shared-host-badge">Shared Databricks access</span>
        <div className="topbar-spacer" />
        {session && (
          <div className="identity">
            <strong>{session.user.displayName || session.user.userName}</strong>
            <span>Veeva user · via {session.executionIdentity.displayName}</span>
          </div>
        )}
        <div className="status-pill" aria-live="polite">
          <span className={`status-dot ${status.tone}`} />
          {status.label}
        </div>
        {connected && (
          <div className="context-actions">
            <a className="quiet-button desktop-only" href={genieWorkspaceUrl(config)} target="_blank" rel="noreferrer">Open in Databricks</a>
            <button className="quiet-button new-chat-button" type="button" onClick={resetConversation} disabled={busy}><PlusIcon /> New chat</button>
          </div>
        )}
      </header>

      {!connected ? (
        <ConnectionGate
          phase={phase}
          error={connectionError}
          problems={problems}
          onConnect={() => void connect()}
        />
      ) : (
        <section className="chat-workspace">
          <div className="mode-bar" role="tablist" aria-label="Genie experience">
            <div className="mode-tabs">
              <ModeButton active={mode === "chat"} disabled={busy} onClick={() => changeMode("chat")} icon={<ChatIcon />} title="Chat" subtitle="Answers, SQL and charts" />
              <ModeButton active={mode === "research"} disabled={busy} onClick={() => changeMode("research")} icon={<ResearchIcon />} title="Research" subtitle="Multi-step Agent mode analysis" preview />
            </div>
            <div className="mode-security shared"><ShieldIcon /><span>Databricks runs as <strong>{session?.executionIdentity.displayName}</strong> · Veeva actor: {session?.user.userName}</span></div>
          </div>

          <div className="transcript" aria-live="polite">
            {messages.length === 0 ? (
              <Welcome mode={mode} onSuggestion={(text) => void send(text)} />
            ) : (
              <div className="message-list">
                {messages.map((message) => <MessageCard key={message.id} message={message} onSuggestion={(text) => void send(text)} />)}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <div className="composer-input">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={mode === "research" ? "Ask for a deeper analysis of the synthetic NSCLC cohort…" : "Ask a question about the synthetic NSCLC cohort…"}
                rows={1}
                maxLength={10_000}
                disabled={busy}
                aria-label="Ask Genie"
              />
              <button className="send-button" type="submit" disabled={!draft.trim() || busy} aria-label="Send question"><SendIcon /></button>
            </div>
            <div className="composer-note">
              <ShieldIcon /> Shared service-principal permissions apply. Databricks audit records the shared identity; the broker correlates your Veeva user.
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

function ConnectionGate({
  phase,
  error,
  problems,
  onConnect,
}: {
  phase: ConnectionPhase;
  error: string;
  problems: string[];
  onConnect: () => void;
}) {
  const configuring = phase === "configuration";
  return (
    <section className="connection-workspace">
      <div className="connection-card">
        <div className="connection-mark" aria-hidden="true"><SparkIcon /></div>
        <p className="eyebrow">Headless Genie · shared Databricks identity</p>
        <h1>{configuring ? "Finish the X‑Page configuration" : phase === "error" ? "Secure connection unavailable" : "Opening shared-access Genie"}</h1>
        <p className="connection-copy">
          {configuring
            ? "The application is built, but required runtime values are missing."
            : "Vault CRM silently verifies its active app session. The broker then uses a fixed Databricks service principal, so there is no separate Databricks or Microsoft sign-in."}
        </p>
        {problems.length > 0 && <ul className="setup-list">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {phase === "connecting" && <div className="connection-progress"><Spinner /> Verifying the active Vault CRM session…</div>}
        {phase === "error" && (
          <button className="connect-button" type="button" onClick={onConnect}>
            <KeyIcon /> Retry secure connection
          </button>
        )}
        <div className="trust-row">
          <span><CheckIcon /> Vault session verified</span>
          <span><CheckIcon /> Fixed Databricks identity</span>
          <span><CheckIcon /> Correlated app audit</span>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  icon,
  title,
  subtitle,
  preview,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  preview?: boolean;
}) {
  return (
    <button className={`mode-button ${active ? "active" : ""}`} type="button" role="tab" aria-selected={active} disabled={disabled} onClick={onClick}>
      <span className="mode-icon">{icon}</span>
      <span><strong>{title}{preview && <em>Preview</em>}</strong><small>{subtitle}</small></span>
    </button>
  );
}

function Welcome({ mode, onSuggestion }: { mode: GenieExperienceMode; onSuggestion: (text: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-mark"><SparkIcon /></div>
      <p className="eyebrow">{mode === "research" ? "Genie Research" : "Synthetic NSCLC real-world evidence"}</p>
      <h1>{mode === "research" ? "What should we investigate?" : "Ask about the NSCLC cohort"}</h1>
      <p>{mode === "research" ? "Research mode plans a multi-step analysis and streams a cited report." : "Explore survival, treatment, biomarkers, demographics, and cost of care in 49,915 fictional Stage IV patients."}</p>
      <div className="suggestion-grid">
        {suggestions.map((text, index) => (
          <button key={text} type="button" onClick={() => onSuggestion(text)}>
            <span>{index === 0 ? <ChartIcon /> : index === 1 ? <TrendIcon /> : <TableIcon />}</span>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageCard({ message, onSuggestion }: { message: UiMessage; onSuggestion: (text: string) => void }) {
  if (message.role === "user") {
    return <article className="message-row user"><div className="user-bubble">{message.content}</div></article>;
  }
  return (
    <article className={`message-row assistant ${message.state}`}>
      <div className="assistant-avatar"><SparkIcon /></div>
      <div className="assistant-body">
        <div className="assistant-label">Genie {message.mode === "research" ? "Research" : "Chat"}</div>
        {message.state === "working" && <div className="working-line"><Spinner /><span>{message.status || message.content}</span></div>}
        {message.state !== "working" && <RichText text={message.content} />}
        {message.researchOutputs?.map((output, index) => <ResearchOutput key={`${message.id}-research-${index}`} value={output} />)}
        {message.visuals?.map((visual) => <VisualizationCard key={visual.attachmentId} visual={visual} />)}
        {message.queries?.map((query) => <QueryResultCard key={query.attachmentId} query={query} hasVisualization={Boolean(message.visuals?.some((visual) => visual.url))} />)}
        {message.sql && message.sql.length > 0 && (
          <details className="sql-details standalone"><summary>Show code</summary>{message.sql.map((sql, index) => <pre key={index}>{sql}</pre>)}</details>
        )}
        {message.suggestions && message.suggestions.length > 0 && (
          <div className="follow-ups">{message.suggestions.slice(0, 4).map((text) => <button key={text} type="button" onClick={() => onSuggestion(text)}>{text}</button>)}</div>
        )}
      </div>
    </article>
  );
}

function QueryResultCard({ query, hasVisualization }: { query: QueryCard; hasVisualization: boolean }) {
  return (
    <div className="evidence-disclosures">
      <details className="data-details" open={!hasVisualization}>
        <summary><TableIcon /> View data{query.loading && <Spinner />}</summary>
        <section className="result-card">
          {query.description && <p className="result-description">{query.description}</p>}
          {query.error && <div className="result-error">{query.error}</div>}
          {query.table && <DataTable table={query.table} />}
        </section>
      </details>
      {query.sql && <details className="sql-details"><summary>Show code</summary><pre>{query.sql}</pre></details>}
    </div>
  );
}

function VisualizationCard({ visual }: { visual: VisualCard }) {
  return (
    <section className="visual-card">
      {visual.loading && <div className="visual-loading"><Spinner /> Generating visualization</div>}
      {visual.url && <img src={visual.url} alt={`${visual.title}. The same governed values are available in View data below.`} />}
      {visual.error && <div className="result-error">Visualization unavailable: {visual.error}</div>}
    </section>
  );
}

function DataTable({ table }: { table: TableData }) {
  return (
    <div className="table-wrap">
      <table><thead><tr>{table.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead>
        <tbody>{table.rows.slice(0, 50).map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}</tr>)}</tbody>
      </table>
      <div className="table-meta">Showing {Math.min(table.rows.length, 50)}{table.totalRows != null ? ` of ${table.totalRows}` : ""} rows{table.truncated ? " · result truncated" : ""}</div>
    </div>
  );
}

function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="rich-text">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.length > 0 && lines.every((line) => line.startsWith("- "))) {
          return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInlineMarkdown(line.slice(2))}</li>)}</ul>;
        }
        return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{renderInlineMarkdown(line)}{lineIndex < lines.length - 1 && <br />}</span>)}</p>;
      })}
    </div>
  );
}

function renderInlineMarkdown(value: string): React.ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  ));
}

function ResearchOutput({ value }: { value: string }) {
  const table = parseMarkdownTable(value);
  if (table) return <section className="result-card"><div className="result-card-header"><TableIcon /><div><strong>Research result</strong><span>Structured output from Agent mode</span></div></div><DataTable table={table} /></section>;
  return <div className="research-note"><RichText text={value} /></div>;
}

async function hydrateChatMessage(
  message: GenieMessage,
  assistantId: string,
  session: BrokerSession,
  brokerBaseUrl: string,
  updateMessage: (id: string, update: (message: UiMessage) => UiMessage) => void,
  visualUrls: Set<string>,
): Promise<void> {
  const attachments = message.attachments ?? [];
  const answers = attachments
    .filter((attachment) => attachment.text?.content)
    .sort((left, right) => answerRank(left) - answerRank(right))
    .map((attachment) => attachment.text?.content || "");
  const queries: QueryCard[] = attachments.flatMap((attachment) => {
    if (!attachment.query || !attachment.attachment_id) return [];
    return [{
      attachmentId: attachment.attachment_id,
      title: attachment.query.title || "Query result",
      description: attachment.query.description,
      sql: attachment.query.query,
      loading: true,
    }];
  });
  const visuals: VisualCard[] = attachments.flatMap((attachment) => {
    if (!attachment.viz || !attachment.attachment_id) return [];
    return [{ attachmentId: attachment.attachment_id, title: attachment.viz.title || "Genie visualization", loading: true }];
  });
  // The GA message API currently returns generated visualization attachments as
  // bare IDs in some workspaces. Probe only otherwise-untyped attachments and
  // add them to the UI after the endpoint confirms that they are images.
  const untypedAttachmentIds = attachments.flatMap((attachment) => {
    if (
      !attachment.attachment_id
      || attachment.query
      || attachment.text
      || attachment.viz
      || attachment.suggested_questions
    ) return [];
    return [attachment.attachment_id];
  });
  const followUps = attachments.flatMap((attachment) => attachment.suggested_questions?.questions ?? []);
  updateMessage(assistantId, (current) => ({
    ...current,
    content: answers.join("\n\n") || (queries.length ? "Here’s what I found in your governed data." : "Genie completed the request."),
    state: "complete",
    status: undefined,
    queries,
    visuals,
    suggestions: followUps,
  }));

  const conversationId = message.conversation_id;
  const messageId = message.message_id ?? message.id;
  if (!messageId) return;
  await Promise.all([
    ...queries.map(async (query) => {
      try {
        const result = await getQueryResult(brokerBaseUrl, session.sessionToken, conversationId, messageId, query.attachmentId);
        const table = toTableData(result);
        updateMessage(assistantId, (current) => ({
          ...current,
          queries: current.queries?.map((item) => item.attachmentId === query.attachmentId ? { ...item, table, loading: false, error: table ? undefined : "No inline rows were returned." } : item),
        }));
      } catch (error) {
        updateMessage(assistantId, (current) => ({
          ...current,
          queries: current.queries?.map((item) => item.attachmentId === query.attachmentId ? { ...item, loading: false, error: humanizeApiError(error) } : item),
        }));
      }
    }),
    ...visuals.map(async (visual) => {
      try {
        const blob = await getVisualization(brokerBaseUrl, session.sessionToken, conversationId, messageId, visual.attachmentId);
        if (!blob.type.startsWith("image/") || blob.size === 0) throw new Error("invalid_visualization_payload");
        const url = URL.createObjectURL(blob);
        visualUrls.add(url);
        updateMessage(assistantId, (current) => ({
          ...current,
          visuals: current.visuals?.map((item) => item.attachmentId === visual.attachmentId ? { ...item, url, loading: false } : item),
        }));
      } catch (error) {
        updateMessage(assistantId, (current) => ({
          ...current,
          visuals: current.visuals?.map((item) => item.attachmentId === visual.attachmentId ? { ...item, loading: false, error: humanizeApiError(error) } : item),
        }));
      }
    }),
    ...untypedAttachmentIds.map(async (attachmentId) => {
      try {
        const blob = await getVisualization(brokerBaseUrl, session.sessionToken, conversationId, messageId, attachmentId);
        if (!blob.type.startsWith("image/") || blob.size === 0) return;
        const url = URL.createObjectURL(blob);
        visualUrls.add(url);
        updateMessage(assistantId, (current) => ({
          ...current,
          visuals: [
            ...(current.visuals ?? []),
            {
              attachmentId,
              title: message.content || queries[0]?.title || "Genie visualization",
              url,
              loading: false,
            },
          ],
        }));
      } catch {
        // Bare attachments also represent follow-up metadata. A 404 from the
        // visualization endpoint means this attachment is not a chart.
      }
    }),
  ]);
}

function renderAgentResponse(response: AgentResponse): { answer: string; outputs: string[]; sql: string[] } {
  const answers: string[] = [];
  const outputs: string[] = [];
  const sql: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type === "message" && item.role === "assistant") {
      for (const content of item.content ?? []) {
        const text = typeof content.text === "string" ? content.text : undefined;
        if (text) answers.push(text);
      }
    }
    if (item.type === "function_call_output" && typeof item.output === "string") outputs.push(item.output);
    if (item.type === "function_call" && typeof item.arguments === "string") {
      try {
        const args = JSON.parse(item.arguments) as { sql?: string };
        if (args.sql) sql.push(args.sql);
      } catch {
        // Ignore malformed optional function metadata.
      }
    }
  }
  return {
    answer: answers.join("\n\n") || "The research run completed. Review the structured results below.",
    outputs,
    sql,
  };
}

function toTableData(payload: QueryResultResponse): TableData | undefined {
  const statement = payload.statement_response;
  const columns = [...(statement?.manifest?.schema?.columns ?? [])]
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((column, index) => column.name || `Column ${index + 1}`);
  const rawRows = statement?.result?.data_array ?? [];
  if (!columns.length && !rawRows.length) return undefined;
  const rows = rawRows.map((row) => {
    const values = Array.isArray(row) ? row : row.values ?? [];
    return values.map(formatStatementValue);
  });
  return {
    columns: columns.length ? columns : Array.from({ length: rows[0]?.length ?? 0 }, (_, index) => `Column ${index + 1}`),
    rows,
    totalRows: statement?.manifest?.total_row_count ?? statement?.result?.row_count,
    truncated: statement?.manifest?.truncated,
  };
}

function formatStatementValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  if (record.null_value != null) return "—";
  for (const key of ["string_value", "number_value", "bool_value"]) {
    if (record[key] != null) return String(record[key]);
  }
  return JSON.stringify(value);
}

function parseMarkdownTable(value: string): TableData | undefined {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line, index) => line.includes("|") && /^\|?\s*:?-+/.test(lines[index + 1] ?? ""));
  if (headerIndex < 0) return undefined;
  const parseRow = (line: string) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const columns = parseRow(lines[headerIndex]);
  const rows = lines.slice(headerIndex + 2).filter((line) => line.includes("|")).map(parseRow);
  return { columns, rows, totalRows: rows.length };
}

function answerRank(attachment: GenieAttachment): number {
  if (attachment.text?.purpose === "TEXT_ATTACHMENT_PURPOSE_ANSWER") return 0;
  if (attachment.text?.purpose === "FOLLOW_UP_QUESTION") return 2;
  return 1;
}

function researchStatusLabel(type: string, item?: AgentOutputItem): string {
  if (type === "response.created") return "Planning the analysis";
  if (item?.type === "reasoning") return "Researching relevant governed data";
  if (item?.type === "function_call") return "Building and running SQL";
  if (item?.type === "function_call_output") return "Reviewing query results";
  if (item?.type === "message") return "Writing the final report";
  return "Researching your question";
}

function chatStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    SUBMITTED: "Question submitted",
    FETCHING_METADATA: "Finding relevant governed data",
    FILTERING_CONTEXT: "Applying context and permissions",
    ASKING_AI: "Reasoning over the question",
    PENDING_WAREHOUSE: "Waiting for the SQL warehouse",
    EXECUTING_QUERY: "Running the generated SQL",
  };
  return status ? labels[status] ?? "Preparing the answer" : "Preparing the answer";
}

function connectionStatus(phase: ConnectionPhase, busy: boolean, mode: GenieExperienceMode): { label: string; tone: string } {
  if (phase === "ready") return busy
    ? { label: mode === "research" ? "Researching" : "Genie is working", tone: "working" }
    : { label: "Shared identity ready", tone: "ready" };
  if (phase === "connecting") return { label: "Connecting", tone: "working" };
  return { label: phase === "configuration" ? "Setup needed" : "Not connected", tone: "attention" };
}

function humanizeConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const labels: Record<string, string> = {
    veeva_vault_session_unavailable: "Vault CRM did not expose its native session bridge. Open this page inside the Vault CRM iPad or iPhone app.",
    veeva_vault_session_timed_out: "Vault CRM did not return its active session in time. Try reopening the X‑Page.",
    veeva_vault_session_invalid_response: "Vault CRM returned an incomplete session response.",
    invalid_vault_session: "The active Vault CRM session could not be verified.",
    vault_identity_unavailable: "The broker could not verify the Vault CRM user right now.",
    vault_origin_not_allowed: "This Vault CRM instance is not allowlisted by the broker.",
    service_principal_token_failed: "The broker could not authenticate the shared Databricks service principal.",
    origin_not_allowed: "This X‑Page origin is not allowlisted by the secure broker.",
    missing_vault_session: "Vault CRM did not provide an active session to the secure broker.",
  };
  return labels[error instanceof BrokerApiError ? error.code : message] ?? "The secure connection could not be completed. Please try again.";
}

function humanizeApiError(error: unknown): string {
  if (error instanceof BrokerApiError) {
    const labels: Record<string, string> = {
      PERMISSION_DENIED: "The shared Databricks service principal does not have permission to query this Genie Agent or its governed data.",
      FEATURE_DISABLED: "Research mode is not enabled in this workspace yet. Switch to Quick chat.",
      session_expired: "Your secure session expired. Reconnect to continue.",
      RESOURCE_CONFLICT: "This conversation is already processing another response.",
      RATE_LIMIT_EXCEEDED: "Genie is receiving too many requests. Wait a moment and try again.",
    };
    return labels[error.code] ?? error.message ?? "Databricks could not complete this request.";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "genie_timed_out") return "Genie is still working, but this page stopped waiting after ten minutes.";
  if (message === "research_stream_incomplete") return "The research stream ended before Genie returned a final report.";
  return message && !message.startsWith("genie_") ? message : "Genie could not complete this request.";
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function SparkIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.8 13.8 9l6.1 1.8-6.1 1.8L12 19l-1.8-6.4-6.1-1.8L10.2 9 12 2.8Z" fill="currentColor"/><path d="m18.7 16 .7 2.3 2.3.7-2.3.7-.7 2.4-.7-2.4-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor" opacity=".72"/></svg>; }
function KeyIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8.2" cy="12" r="4.2" stroke="currentColor" strokeWidth="2"/><path d="M12.4 12H22m-3 0v3m-3-3v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>; }
function CheckIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 10.4 3.1 3.1L15.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ShieldIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5 16 5v4.2c0 3.7-2.3 6.4-6 8.3-3.7-1.9-6-4.6-6-8.3V5l6-2.5Z" stroke="currentColor" strokeWidth="1.6"/><path d="m7.3 10 1.8 1.8 3.7-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChatIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5h14v11H9l-4 3V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function ResearchIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.8"/><path d="m15 15 4.5 4.5M8 10.5h5M10.5 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>; }
function SendIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M7 12h14" stroke="currentColor" strokeWidth="1.8"/></svg>; }
function TableIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M3 10h18M9 5v14" stroke="currentColor" strokeWidth="1.5"/></svg>; }
function ChartIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 19V5M4 19h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="m7 15 3-4 3 2 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function PlusIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>; }
function TrendIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 18V6M4 18h16M7 14l4-4 3 2 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function Spinner() { return <span className="spinner" aria-hidden="true" />; }
