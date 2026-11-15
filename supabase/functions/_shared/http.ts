export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type JsonHandler = (
  request: Request,
  body: Record<string, unknown>,
) => Promise<unknown>;

async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new HttpError(400, "invalid_body", "A JSON request body is required.");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > 16_384) {
      await reader.cancel();
      throw new HttpError(413, "request_too_large", "The request is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

function getAllowedOrigins(): Set<string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) {
    return new Set([
      "http://localhost:5500",
      "http://127.0.0.1:5500",
    ]);
  }
  return new Set(configured.split(",").map((origin) => origin.trim()).filter(Boolean));
}

export async function serveJson(
  request: Request,
  functionName: string,
  handler: JsonHandler,
): Promise<Response> {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !getAllowedOrigins().has(origin)) {
    return Response.json(
      { error: "origin_not_allowed", message: "This website is not allowed to use the service." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const corsHeaders = {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    "content-type": "application/json",
    "vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", "Use POST for this operation.");
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      throw new HttpError(413, "request_too_large", "The request is too large.");
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      throw new HttpError(415, "unsupported_media_type", "Send a JSON request.");
    }

    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "invalid_body", "The request body must be a JSON object.");
    }

    const result = await handler(request, body as Record<string, unknown>);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    const safeError = error instanceof HttpError
      ? error
      : new HttpError(500, "internal_error", "The request could not be completed.");
    console.error(JSON.stringify({
      function: functionName,
      code: safeError.code,
      status: safeError.status,
    }));
    return Response.json(
      { error: safeError.code, message: safeError.message },
      { status: safeError.status, headers: corsHeaders },
    );
  }
}
