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

export async function listProjectApiKeys(
  projectId: string
): Promise<{ data: Array<{ id: string; name: string; redacted_value: string }> }> {
  const res = await fetch(
    `${OPENAI_API_BASE}/organization/projects/${projectId}/api_keys`,
    { headers: headers(), cache: "no-store" }
  );
  if (!res.ok)
    throw new Error(`OpenAI listProjectApiKeys failed: ${res.status}`);
  return res.json();
}

export async function deleteServiceAccount(
  projectId: string,
  serviceAccountId: string
): Promise<void> {
  const url = `${OPENAI_API_BASE}/organization/projects/${projectId}/service_accounts/${serviceAccountId}`;
  // Use https module directly to avoid Next.js fetch patching
  const { default: https } = await import("https");
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(url);
    const req = https.request(
      {
        hostname: reqUrl.hostname,
        path: reqUrl.pathname,
        method: "DELETE",
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
              new Error(
                `OpenAI deleteServiceAccount failed: ${res.statusCode} ${data}`
              )
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function archiveProject(projectId: string): Promise<void> {
  const url = `${OPENAI_API_BASE}/organization/projects/${projectId}/archive`;
  const { default: https } = await import("https");
  return new Promise((resolve, reject) => {
    const reqUrl = new URL(url);
    const req = https.request(
      {
        hostname: reqUrl.hostname,
        path: reqUrl.pathname,
        method: "POST",
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
              new Error(
                `OpenAI archiveProject failed: ${res.statusCode} ${data}`
              )
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}
