import { handleOpenAIProxyRequest } from "@/lib/proxy/openai-route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  return handleOpenAIProxyRequest({ req, endpoint: "responses" });
}
