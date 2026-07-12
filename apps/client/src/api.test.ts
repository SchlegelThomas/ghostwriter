import { afterEach, describe, expect, it, vi } from "vitest";
import { signOut } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ghostwriter API client", () => {
  it("sends a valid empty JSON document when signing out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-out",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        }
      })
    );
  });
});
