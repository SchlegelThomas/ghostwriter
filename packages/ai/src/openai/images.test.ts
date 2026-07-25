import { describe, expect, it, vi } from "vitest";
import { generateOpenAiImageForTests } from "./images.js";

const SECRET_KEY = "sk-test-image-secret-never-log";
const PROMPT = "Quiet literary study of a harbor lantern.";

describe("generateOpenAiImageForTests", () => {
  it("posts Images API shape with bearer auth and returns b64 + data URI", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          data: [{ b64_json: "aGVsbG8=" }]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    });

    const result = await generateOpenAiImageForTests(
      { apiKey: SECRET_KEY, prompt: PROMPT },
      {
        baseUrl: "https://example.test",
        fetchImpl: fetchImpl as typeof fetch
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.b64Json).toBe("aGVsbG8=");
    expect(result.dataUri).toBe("data:image/png;base64,aGVsbG8=");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example.test/v1/images/generations");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${SECRET_KEY}`);
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-image-1",
      prompt: PROMPT,
      n: 1,
      size: "1024x1024"
    });
    expect(body).not.toHaveProperty("response_format");
    expect(JSON.stringify(result)).not.toContain(SECRET_KEY);
  });

  it("keeps response_format only for legacy DALL·E models", async () => {
    const calls: { init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {} });
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    await generateOpenAiImageForTests(
      { apiKey: SECRET_KEY, prompt: PROMPT, model: "dall-e-3" },
      {
        baseUrl: "https://example.test",
        fetchImpl: fetchImpl as typeof fetch
      }
    );
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "dall-e-3",
      response_format: "b64_json"
    });
  });

  it("maps auth failures and empty prompts without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    const authFailed = await generateOpenAiImageForTests(
      { apiKey: SECRET_KEY, prompt: PROMPT },
      {
        baseUrl: "https://example.test",
        fetchImpl: fetchImpl as typeof fetch
      }
    );
    expect(authFailed).toEqual({
      ok: false,
      diagnostic: { code: "auth_failed", retryable: false }
    });
    expect(JSON.stringify(authFailed)).not.toContain(SECRET_KEY);

    const empty = await generateOpenAiImageForTests(
      { apiKey: SECRET_KEY, prompt: "   " },
      {
        baseUrl: "https://example.test",
        fetchImpl: fetchImpl as typeof fetch
      }
    );
    expect(empty).toEqual({
      ok: false,
      diagnostic: { code: "validation_failed", retryable: false }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
