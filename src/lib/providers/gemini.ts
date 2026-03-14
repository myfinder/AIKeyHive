const API_KEYS_BASE = "https://apikeys.googleapis.com/v2";

async function getAccessToken(): Promise<string> {
  // Use Google Application Default Credentials
  // In production, this uses the service account
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token || "";
}

function projectPath() {
  return `projects/${process.env.GOOGLE_PROJECT_ID}/locations/global`;
}

export interface GcpApiKey {
  name: string; // projects/{project}/locations/global/keys/{keyId}
  uid: string;
  displayName: string;
  keyString?: string;
  createTime: string;
}

export async function createKey(
  displayName: string
): Promise<{ key: GcpApiKey; keyString: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${API_KEYS_BASE}/${projectPath()}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      displayName,
      restrictions: {
        apiTargets: [
          { service: "generativelanguage.googleapis.com" },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`GCP createKey failed: ${res.status}`);
  const operation = await res.json();

  // Poll operation for completion
  let result = operation;
  while (!result.done) {
    await new Promise((r) => setTimeout(r, 1000));
    const pollRes = await fetch(
      `https://apikeys.googleapis.com/v2/${result.name}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    result = await pollRes.json();
  }

  const key = result.response as GcpApiKey;

  // Get the key string
  const keyStringRes = await fetch(
    `${API_KEYS_BASE}/${key.name}/keyString`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { keyString } = await keyStringRes.json();

  return { key, keyString };
}

export async function listKeys(): Promise<GcpApiKey[]> {
  const token = await getAccessToken();
  const res = await fetch(`${API_KEYS_BASE}/${projectPath()}/keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GCP listKeys failed: ${res.status}`);
  const data = await res.json();
  return data.keys || [];
}

export async function deleteKey(keyName: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${API_KEYS_BASE}/${keyName}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GCP deleteKey failed: ${res.status}`);
}

export function extractKeyId(keyName: string): string {
  // keyName format: projects/{project}/locations/global/keys/{keyId}
  return keyName.split("/").pop() || keyName;
}
