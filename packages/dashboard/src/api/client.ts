import {
  ADMIN_API_PATHS,
  AdminMessage,
  ApiKeyDetailResponse,
  EnqueueMessageResponse,
  ListApiKeysResponse,
  ListMessagesResponse,
  ListSessionsResponse,
  SessionDetailResponse,
  type EnqueueMessageBody,
  type ListSessionsQuery,
  type UpdateMessageBody
} from "@chatcoder/shared";
import { BOT_API_URL } from "../config";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type RequestArgs = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

function encodeQuery(query?: RequestArgs["query"]): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function errorEnvelope(body: unknown): { code: string; message: string } {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: unknown }).error;
    if (e && typeof e === "object") {
      const code = (e as { code?: unknown }).code;
      const message = (e as { message?: unknown }).message;
      return {
        code: typeof code === "string" ? code : "UNKNOWN",
        message: typeof message === "string" ? message : "Request failed"
      };
    }
  }
  return { code: "UNKNOWN", message: "Request failed" };
}

async function request(args: RequestArgs): Promise<{ status: number; body: unknown }> {
  const url = `${BOT_API_URL}${args.path}${encodeQuery(args.query)}`;
  const init: RequestInit = {
    method: args.method,
    headers: args.body !== undefined ? { "content-type": "application/json" } : {},
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined
  };
  const res = await fetch(url, init);
  const text = await res.text();
  const body: unknown = text.length ? JSON.parse(text) : undefined;
  return { status: res.status, body };
}

function ok<T>(parse: (x: unknown) => T, res: { status: number; body: unknown }): T {
  if (res.status >= 200 && res.status < 300) return parse(res.body);
  const env = errorEnvelope(res.body);
  throw new ApiClientError(res.status, env.code, env.message);
}

function okOrNull<T>(
  parse: (x: unknown) => T,
  res: { status: number; body: unknown }
): T | null {
  if (res.status === 404) return null;
  return ok(parse, res);
}

function okOrFalse(res: { status: number; body: unknown }): boolean {
  if (res.status === 404) return false;
  if (res.status >= 200 && res.status < 300) return true;
  const env = errorEnvelope(res.body);
  throw new ApiClientError(res.status, env.code, env.message);
}

/* =============== API keys =============== */

export async function listApiKeys(): Promise<ListApiKeysResponse> {
  const res = await request({ method: "GET", path: ADMIN_API_PATHS.apiKeys });
  return ok((b) => ListApiKeysResponse.parse(b), res);
}

export async function getApiKeyDetail(id: string): Promise<ApiKeyDetailResponse | null> {
  const res = await request({ method: "GET", path: ADMIN_API_PATHS.apiKey(id) });
  return okOrNull((b) => ApiKeyDetailResponse.parse(b), res);
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const res = await request({
    method: "POST",
    path: `${ADMIN_API_PATHS.apiKey(id)}/revoke`
  });
  return okOrFalse(res);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const res = await request({ method: "DELETE", path: ADMIN_API_PATHS.apiKey(id) });
  return okOrFalse(res);
}

/* =============== Sessions =============== */

export async function listSessions(query: ListSessionsQuery): Promise<ListSessionsResponse> {
  const res = await request({
    method: "GET",
    path: ADMIN_API_PATHS.sessions,
    query: {
      status: query.status,
      chatId: query.chatId,
      apiKeyId: query.apiKeyId,
      limit: query.limit,
      offset: query.offset
    }
  });
  return ok((b) => ListSessionsResponse.parse(b), res);
}

export async function getSessionDetail(id: string): Promise<SessionDetailResponse | null> {
  const res = await request({ method: "GET", path: ADMIN_API_PATHS.sessionDetail(id) });
  return okOrNull((b) => SessionDetailResponse.parse(b), res);
}

export async function revokeSession(id: string): Promise<boolean> {
  const res = await request({ method: "POST", path: ADMIN_API_PATHS.revoke(id) });
  return okOrFalse(res);
}

export async function deleteSession(id: string): Promise<boolean> {
  const res = await request({ method: "DELETE", path: ADMIN_API_PATHS.session(id) });
  return okOrFalse(res);
}

export async function purgeSession(id: string): Promise<boolean> {
  const res = await request({ method: "POST", path: ADMIN_API_PATHS.purge(id) });
  return okOrFalse(res);
}

/* =============== Messages =============== */

export async function listMessages(sessionId: string): Promise<ListMessagesResponse> {
  const res = await request({ method: "GET", path: ADMIN_API_PATHS.messages(sessionId) });
  return ok((b) => ListMessagesResponse.parse(b), res);
}

export async function enqueueMessage(
  sessionId: string,
  body: EnqueueMessageBody
): Promise<EnqueueMessageResponse | null> {
  const res = await request({
    method: "POST",
    path: ADMIN_API_PATHS.messages(sessionId),
    body
  });
  return okOrNull((b) => EnqueueMessageResponse.parse(b), res);
}

export async function getMessage(id: string): Promise<AdminMessage | null> {
  const res = await request({ method: "GET", path: ADMIN_API_PATHS.message(id) });
  return okOrNull((b) => AdminMessage.parse(b), res);
}

export async function updateMessage(id: string, body: UpdateMessageBody): Promise<boolean> {
  const res = await request({ method: "PATCH", path: ADMIN_API_PATHS.message(id), body });
  return okOrFalse(res);
}

export async function deleteMessage(id: string): Promise<boolean> {
  const res = await request({ method: "DELETE", path: ADMIN_API_PATHS.message(id) });
  return okOrFalse(res);
}
