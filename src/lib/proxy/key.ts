import { createHash, randomBytes } from "crypto";

export function createProxyKeySecret(): string {
  return `akp_${randomBytes(32).toString("base64url")}`;
}

export function hashProxyKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function keyHint(secret: string): string {
  return `akp_...${secret.slice(-6)}`;
}
