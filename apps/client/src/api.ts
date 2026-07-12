import type {
  ProjectCommand,
  ProjectNavigator,
  StoryProjectSummary,
  WriterProfile
} from "@ghostwriter/core";

export type SessionAccount = Readonly<{
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}>;

export type CurrentWriter = Readonly<{
  account: SessionAccount;
  profile: WriterProfile;
  session: Readonly<{ id: string; expiresAt: string }>;
}>;

export class GhostwriterApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GhostwriterApiError";
    this.status = status;
    this.code = code;
  }
}

function apiUrl(path: string): string {
  const configuredOrigin = process.env.EXPO_PUBLIC_API_URL;
  if (configuredOrigin === undefined || configuredOrigin.length === 0) return path;
  return new URL(path, configuredOrigin).toString();
}

async function requestJson<Output>(
  path: string,
  init: RequestInit = {}
): Promise<Output> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...init.headers
    }
  });
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new GhostwriterApiError(
      response.status,
      body.code ?? "REQUEST_FAILED",
      body.error ?? "Ghostwriter could not complete the request."
    );
  }
  return body as Output;
}

function jsonRequest(method: "POST" | "PATCH", body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

export function getCurrentWriter(): Promise<CurrentWriter> {
  return requestJson("/api/me");
}

export function updateWriterProfile(input: {
  displayName: string;
  expectedVersion: number;
}): Promise<Readonly<{ profile: WriterProfile }>> {
  return requestJson("/api/me/profile", jsonRequest("PATCH", input));
}

export async function beginGoogleSignIn(callbackURL: string): Promise<string> {
  const result = await requestJson<Readonly<{ url: string }>>(
    "/api/auth/sign-in/social",
    jsonRequest("POST", {
      provider: "google",
      callbackURL,
      newUserCallbackURL: callbackURL,
      errorCallbackURL: `${callbackURL}?authError=google`
    })
  );
  return result.url;
}

export function signOut(): Promise<unknown> {
  return requestJson("/api/auth/sign-out", jsonRequest("POST", {}));
}

export async function listProjects(
  includeArchived = false
): Promise<readonly StoryProjectSummary[]> {
  const result = await requestJson<Readonly<{ projects: StoryProjectSummary[] }>>(
    `/api/projects${includeArchived ? "?includeArchived=true" : ""}`
  );
  return result.projects;
}

export function createProject(input: {
  title: string;
  firstBookTitle: string;
}): Promise<ProjectNavigator> {
  return requestJson("/api/projects", jsonRequest("POST", input));
}

export function getProject(projectId: string): Promise<ProjectNavigator> {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/navigator`);
}

export function executeProjectCommand(input: {
  projectId: string;
  expectedVersion: number;
  command: ProjectCommand;
}): Promise<ProjectNavigator> {
  return requestJson(
    `/api/projects/${encodeURIComponent(input.projectId)}/commands`,
    jsonRequest("POST", {
      expectedVersion: input.expectedVersion,
      command: input.command
    })
  );
}
