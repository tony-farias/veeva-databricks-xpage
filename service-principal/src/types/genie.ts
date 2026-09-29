export interface BrokerUser {
  userName: string;
  displayName: string | null;
}

export interface ExecutionIdentity {
  applicationId: string;
  displayName: string;
}

export interface BrokerSession {
  sessionToken: string;
  expiresAt: string;
  authorizationMode: "service_principal";
  user: BrokerUser;
  executionIdentity: ExecutionIdentity;
}

export interface GenieTextAttachment {
  id?: string;
  content?: string;
  purpose?: string;
}

export interface GenieQueryAttachment {
  id?: string;
  title?: string;
  description?: string;
  query?: string;
  statement_id?: string;
  query_result_metadata?: { row_count?: number; is_truncated?: boolean };
}

export interface GenieVisualizationAttachment {
  title?: string;
  query_attachment_id?: string;
}

export interface GenieAttachment {
  attachment_id?: string;
  text?: GenieTextAttachment;
  query?: GenieQueryAttachment;
  viz?: GenieVisualizationAttachment;
  suggested_questions?: { questions?: string[] };
}

export interface GenieMessage {
  message_id?: string;
  id?: string;
  conversation_id: string;
  content: string;
  status?: string;
  attachments?: GenieAttachment[] | null;
  error?: { error?: string; type?: string } | null;
}

export interface StartConversationResponse {
  conversation_id?: string;
  message_id?: string;
  conversation?: { conversation_id?: string; id?: string };
  message?: GenieMessage;
}

export interface StatementColumn {
  name?: string;
  type_name?: string;
  position?: number;
}

export interface StatementValue {
  string_value?: string;
  number_value?: number;
  bool_value?: boolean;
  null_value?: string;
  [key: string]: unknown;
}

export interface QueryResultResponse {
  statement_response?: {
    status?: { state?: string; error?: { message?: string; error_code?: string } };
    manifest?: {
      schema?: { columns?: StatementColumn[] };
      total_row_count?: number;
      truncated?: boolean;
    };
    result?: {
      data_array?: Array<{ values?: StatementValue[] } | unknown[]>;
      row_count?: number;
    };
  };
}

export interface AgentOutputItem {
  id?: string;
  type?: string;
  role?: string;
  status?: string;
  name?: string;
  arguments?: string;
  output?: string;
  content?: Array<Record<string, unknown>>;
  summary?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface AgentResponse {
  id?: string;
  status?: string;
  conversation_id?: string;
  output?: AgentOutputItem[];
  error?: { code?: string; message?: string };
}

export interface AgentStreamEvent {
  type?: string;
  sequence_number?: number;
  item?: AgentOutputItem;
  response?: AgentResponse;
  [key: string]: unknown;
}
