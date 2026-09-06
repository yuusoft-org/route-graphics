import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetBufferManager } from "../../src/util/createAssetBufferManager.js";

describe("createAssetBufferManager", () => {
  it("round-trips prototype-key aliases as own properties", async () => {
    const manager = createAssetBufferManager();
    const assets = Object.fromEntries(
      ["__proto__", "constructor", "toString"].map((key) => [
        key,
        { url: `https://example.test/${key}.png`, type: "image/png" },
      ]),
    );
    await manager.load(assets);
    const result = manager.getBufferMap();
    expect(Object.keys(result).sort()).toEqual(Object.keys(assets).sort());
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    for (const key of Object.keys(assets))
      expect(result[key].url).toBe(assets[key].url);
  });

  it("deduplicates pending loads and prevents old results crossing clear", async () => {
    const responses = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => responses.push(resolve))),
    );
    const manager = createAssetBufferManager();
    const oldAssets = { voice: { url: "old.wav", type: "audio/wav" } };
    const old = manager.load(oldAssets);
    const duplicate = manager.load(oldAssets);
    expect(fetch).toHaveBeenCalledTimes(1);
    manager.clear();
    const next = manager.load({ voice: { url: "new.wav", type: "audio/wav" } });
    const newBytes = new Uint8Array([2]).buffer;
    responses[1]({ ok: true, arrayBuffer: async () => newBytes });
    await next;
    responses[0]({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    await Promise.all([old, duplicate]);
    expect(manager.getBufferMap().voice.buffer).toBe(newBytes);
  });

  it("allows a failed download to be retried", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(1),
        }),
    );
    const manager = createAssetBufferManager();
    const assets = { voice: { url: "voice.wav", type: "audio/wav" } };
    await expect(manager.load(assets)).rejects.toThrow();
    await manager.load(assets);
    expect(manager.has("voice")).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects failed fetches with asset key, type, URL, and HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        }),
      ),
    );

    const manager = createAssetBufferManager();

    let thrownError;
    try {
      await manager.load({
        themeMusic: {
          url: "https://cdn.example.test/theme.mp3",
          type: "audio/mpeg",
        },
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError?.message).toBe(
      'Could not load asset "themeMusic". File not found.',
    );
    expect(thrownError?.details).toEqual(
      expect.objectContaining({
        assetKey: "themeMusic",
        type: "audio/mpeg",
        url: "https://cdn.example.test/theme.mp3",
        cause: "HTTP 404 Not Found",
      }),
    );
  });

  it("rejects missing asset URLs with asset key and root cause", async () => {
    const manager = createAssetBufferManager();

    await expect(
      manager.load({
        brokenAsset: {
          type: "audio/mpeg",
        },
      }),
    ).rejects.toThrow('Could not load asset "brokenAsset". Missing file URL.');
  });
});
