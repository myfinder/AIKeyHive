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
  });
  if (!res.ok) throw new Error(`OpenAI createProject failed: ${res.status}`);
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
    }
  );
  if (!res.ok)
    throw new Error(`OpenAI createServiceAccount failed: ${res.status}`);
  return res.json();
}

export async function listProjectApiKeys(
  projectId: string
): Promise<{ data: Array<{ id: string; name: string; redacted_value: string }> }> {
  const res = await fetch(
    `${OPENAI_API_BASE}/organization/projects/${projectId}/api_keys`,
    { headers: headers() }
  );
  if (!res.ok)
    throw new Error(`OpenAI listProjectApiKeys failed: ${res.status}`);
  return res.json();
}

export async function deleteProjectApiKey(
  projectId: string,
  keyId: string
): Promise<void> {
  const res = await fetch(
    `${OPENAI_API_BASE}/organization/projects/${projectId}/api_keys/${keyId}`,
    { method: "DELETE", headers: headers() }
  );
  if (!res.ok)
    throw new Error(`OpenAI deleteProjectApiKey failed: ${res.status}`);
}
