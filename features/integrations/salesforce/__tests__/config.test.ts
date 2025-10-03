import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  buildLike,
  buildTokenRequestParams,
  consumePkceVerifier,
  consumeSalesforceOAuthContext,
  escapeSoqlLike,
  generatePkce,
  getPkceKey,
  getSalesforceCredentials,
  storeSalesforceOAuthContext,
  resolveSalesforceLoginUrl,
  resolveSalesforceUrl,
  resolveStateForPkce,
  storePkceVerifier,
} from "../common";
import crypto from "crypto";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SALESFORCE_APP_KEY = "env-key";
  process.env.SALESFORCE_APP_SECRET = "env-secret";
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("Salesforce common helpers", () => {
  it("resolves URLs with or without protocol", () => {
    expect(resolveSalesforceUrl("https://example.com")).toBe("https://example.com");
    expect(resolveSalesforceUrl("example.my.salesforce.com")).toBe("https://example.my.salesforce.com");
  });

  it("uses metadata login URL when provided", () => {
    process.env.SALESFORCE_LOGIN_URL = "https://env-login.salesforce.com";

    const url = resolveSalesforceLoginUrl({
      domain: "example.my.salesforce.com",
      metadata: { loginUrl: "https://custom-login.salesforce.com" },
    } as any);

    expect(url).toBe("https://custom-login.salesforce.com");
  });

  it("falls back to platform domain before env login URL", () => {
    process.env.SALESFORCE_LOGIN_URL = "https://env-login.salesforce.com";

    const url = resolveSalesforceLoginUrl({
      domain: "example.my.salesforce.com",
      metadata: {},
    } as any);

    expect(url).toBe("https://example.my.salesforce.com");
  });

  it("uses env login URL when neither metadata nor domain are provided", () => {
    process.env.SALESFORCE_LOGIN_URL = "https://env-login.salesforce.com";

    const url = resolveSalesforceLoginUrl({
      domain: " ",
      metadata: {},
    } as any);

    expect(url).toBe("https://env-login.salesforce.com");
  });

  it("escapes SOQL LIKE wildcards", () => {
    expect(escapeSoqlLike("Test_%"))
      .toBe("Test\\_\\%");
    expect(buildLike("Widget"))
      .toBe("%Widget%");
  });

  it("falls back to environment credentials when platform does not include keys", () => {
    const result = getSalesforceCredentials({ domain: "example.my.salesforce.com" }, undefined, undefined);
    expect(result.clientId).toBe("env-key");
    expect(result.clientSecret).toBe("env-secret");
  });

  it("prefers platform credentials over environment values", () => {
    const result = getSalesforceCredentials({
      domain: "example.my.salesforce.com",
      appKey: "platform-key",
      appSecret: "platform-secret",
    });

    expect(result.clientId).toBe("platform-key");
    expect(result.clientSecret).toBe("platform-secret");
  });

  it("generates PKCE pairs in the correct format", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);

    const expectedChallenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    expect(challenge).toBe(expectedChallenge);
  });

  it("stores PKCE verifiers keyed by nonce", () => {
    const resolved = resolveStateForPkce(undefined);
    const key = getPkceKey(resolved);

    storePkceVerifier(key, "verifier-value", { ttlMs: 1000, alias: resolved.state });
    expect(consumePkceVerifier(key)).toBe("verifier-value");
    expect(consumePkceVerifier(key)).toBeUndefined();
  });

  it("expires PKCE verifiers when TTL elapses", () => {
    const resolved = resolveStateForPkce(undefined);
    const key = getPkceKey(resolved);

    storePkceVerifier(key, "expired", { ttlMs: 0, alias: resolved.state });
    expect(consumePkceVerifier(key)).toBeUndefined();
  });

  it("resolves PKCE verifier via state alias when nonce lookup fails", () => {
    const resolved = resolveStateForPkce(undefined);
    const key = getPkceKey(resolved);

    storePkceVerifier(key, "alias-value", { alias: resolved.state });
    // Consume using state key instead of nonce
    expect(consumePkceVerifier(resolved.state)).toBe("alias-value");
  });

  it("stores and consumes Salesforce OAuth context with aliases", () => {
    const resolved = resolveStateForPkce(undefined);
    const key = getPkceKey(resolved);

    storeSalesforceOAuthContext(
      key,
      { domain: "example.my.salesforce.com", loginUrl: "https://example.my.salesforce.com" },
      { alias: resolved.state }
    );

    const viaAlias = consumeSalesforceOAuthContext(resolved.state);
    expect(viaAlias).toEqual({
      domain: "example.my.salesforce.com",
      loginUrl: "https://example.my.salesforce.com",
    });

    expect(consumeSalesforceOAuthContext(key)).toBeUndefined();
  });

  it("builds token request params with conditional fields", () => {
    const baseParams = buildTokenRequestParams({
      code: "code123",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "https://app/callback",
    });

    expect(baseParams.get("grant_type")).toBe("authorization_code");
    expect(baseParams.get("code")).toBe("code123");
    expect(baseParams.get("client_id")).toBe("client");
    expect(baseParams.get("client_secret")).toBe("secret");
    expect(baseParams.get("redirect_uri")).toBe("https://app/callback");
    expect(baseParams.get("code_verifier")).toBeNull();

    const pkceParams = buildTokenRequestParams({
      code: "code123",
      clientId: "client",
      codeVerifier: "verifier123",
    });

    expect(pkceParams.get("client_secret")).toBeNull();
    expect(pkceParams.get("code_verifier")).toBe("verifier123");
  });
});
