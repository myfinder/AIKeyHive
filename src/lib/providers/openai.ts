const OPENAI_API_BASE = "https://api.openai.com/v1";

function headers() {
  return {
    Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Organization": process.env.OPENAI_ORG_ID || "",
  };
}

export interface OpenAIProject {
  id: string;
  name: string;
}

export interface OpenAIProjectApiKey {
  id: string;
  name: string | null;
  redacted_value: string;
  created_at?: number;
  last_used_at?: number | null;
  owner?: {
    type: "user" | "service_account";
    user?: { id: string; name?: string; email?: string };
    service_account?: { id: string; name?: string };
  };
}

export interface OpenAIServiceAccount {
  id: string;
  name: string;
  api_key: {
    value: string;
    name: string;
    id: string;
  };
}

export async function createProject(name: string): Promise<OpenAIProject> {
  const res = await fetch(`${OPENAI_API_BASE}/organization/projects`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI createProject failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function createServiceAccountKey(
  projectId: string,
  name: string
): Promise<OpenAIServiceAccount> {
  const res = await fetch(
    `${OPENAI_API_BASE}/organization/projects/${projectId}/service_accounts`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name }),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI createServiceAccount failed: ${res.status} ${body}`);
  }
  return res.json();
}

export async function listProjects(): Promise<OpenAIProject[]> {
  const projects: OpenAIProject[] = [];
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (after) params.set("after", after);
    const res = await fetch(
      `${OPENAI_API_BASE}/organization/projects?${params}`,
      { headers: headers(), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`OpenAI listProjects failed: ${res.status}`);
    const body = await res.json();
    projects.push(...(body.data || []));
    after = body.has_more ? body.last_id : undefined;
  } while (after);
  return projects;
}

export async function listProjectApiKeys(
  projectId: string
): Promise<{ data: OpenAIProjectApiKey[] }> {
  const keys: OpenAIProjectApiKey[] = [];
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (after) params.set("after", after);
    const res = await fetch(
      `${OPENAI_API_BASE}/organization/projects/${projectId}/api_keys?${params}`,
      { headers: headers(), cache: "no-store" }
    );
    if (!res.ok)
      throw new Error(`OpenAI listProjectApiKeys failed: ${res.status}`);
    const body = await res.json();
    keys.push(...(body.data || []));
    after = body.has_more ? body.last_id : undefined;
  } while (after);
  return { data: keys };
}

// Use https module directly to avoid Next.js fetch patching
async function rawRequest(
  method: "DELETE" | "POST",
  url: string,
  label: string
): Promise<void> {
  const { default: https } = await import("https");
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(url);
    const req = https.request(
      {
        hostname: reqUrl.hostname,
        path: reqUrl.pathname,
        method,
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_ADMIN_KEY}`,
          "OpenAI-Organization": process.env.OPENAI_ORG_ID || "",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(
              new Error(`OpenAI ${label} failed: ${res.statusCode} ${data}`)
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function deleteServiceAccount(
  projectId: string,
  serviceAccountId: string
): Promise<void> {
  return rawRequest(
    "DELETE",
    `${OPENAI_API_BASE}/organization/projects/${projectId}/service_accounts/${serviceAccountId}`,
    "deleteServiceAccount"
  );
}

export async function deleteProjectApiKey(
  projectId: string,
  keyId: string
): Promise<void> {
  return rawRequest(
    "DELETE",
    `${OPENAI_API_BASE}/organization/projects/${projectId}/api_keys/${keyId}`,
    "deleteProjectApiKey"
  );
}

export async function archiveProject(projectId: string): Promise<void> {
  return rawRequest(
    "POST",
    `${OPENAI_API_BASE}/organization/projects/${projectId}/archive`,
    "archiveProject"
  );
}
