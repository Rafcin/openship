import { Connection, OAuth2 } from "jsforce";
import crypto from "crypto";

const PKCE_STORE_TTL_MS = 5 * 60 * 1000;

type PkceStoreEntry = {
  verifier: string;
  expiresAt: number;
};

type SalesforceOAuthContextEntry = {
  domain?: string;
  loginUrl?: string;
  metadataLoginUrl?: string;
};

// Use global to persist across Next.js hot reloads in development
const globalForPkce = globalThis as unknown as {
  pkceStore: Map<string, PkceStoreEntry>;
  pkceAliases: Map<string, string>;
  salesforceOAuthContextStore: Map<string, SalesforceOAuthContextEntry>;
  salesforceOAuthContextAliases: Map<string, string>;
};

const pkceStore = globalForPkce.pkceStore ?? new Map<string, PkceStoreEntry>();
const pkceAliases = globalForPkce.pkceAliases ?? new Map<string, string>();
const salesforceOAuthContextStore =
  globalForPkce.salesforceOAuthContextStore ?? new Map<string, SalesforceOAuthContextEntry>();
const salesforceOAuthContextAliases =
  globalForPkce.salesforceOAuthContextAliases ?? new Map<string, string>();

if (process.env.NODE_ENV !== 'production') {
  globalForPkce.pkceStore = pkceStore;
  globalForPkce.pkceAliases = pkceAliases;
  globalForPkce.salesforceOAuthContextStore = salesforceOAuthContextStore;
  globalForPkce.salesforceOAuthContextAliases = salesforceOAuthContextAliases;
}

export interface SalesforcePlatformBase {
  domain: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string | Date;
  instanceUrl?: string;
  appKey?: string;
  appSecret?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface SalesforceConnectionOptions {
  platform: SalesforcePlatformBase;
  appKeyOverride?: string;
  appSecretOverride?: string;
  redirectUri?: string;
  onTokenRefresh?: (params: { accessToken: string; refreshToken?: string; instanceUrl?: string }) => Promise<void> | void;
}

export interface SalesforceQueryPageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

export interface SalesforceQueryResult<T> {
  records: T[];
  pageInfo: SalesforceQueryPageInfo;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): string | undefined {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + padding, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

function createFallbackState(): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({ nonce });
  const state = base64UrlEncode(Buffer.from(payload));
  return { state, nonce };
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error("Generated PKCE verifier is outside the required length range");
  }

  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function storePkceVerifier(
  key: string | undefined,
  verifier: string,
  options: { ttlMs?: number; alias?: string } = {}
) {
  if (!key || !verifier) {
    console.warn("storePkceVerifier skipped due to missing key or verifier", { keyPresent: !!key, verifierPresent: !!verifier });
    return;
  }

  const { ttlMs = PKCE_STORE_TTL_MS, alias } = options;

  pkceStore.set(key, {
    verifier,
    expiresAt: Date.now() + ttlMs,
  });

  console.debug("PKCE verifier stored", { key, alias, expiresAt: pkceStore.get(key)?.expiresAt });

  if (alias && alias !== key) {
    pkceAliases.set(alias, key);
    console.debug("PKCE alias registered", { alias, key });
  }
}

export function consumePkceVerifier(key?: string | null): string | undefined {
  if (!key) {
    return undefined;
  }

  let entryKey = key;
  let entry = pkceStore.get(entryKey);

  if (!entry) {
    const aliasTarget = pkceAliases.get(entryKey);
    if (aliasTarget) {
      entryKey = aliasTarget;
      entry = pkceStore.get(entryKey);
      console.debug("PKCE verifier resolved via alias", { requestedKey: key, aliasTarget: entryKey, found: !!entry });
    }
  }

  if (!entry) {
    console.warn("PKCE verifier not found", {
      key,
      storeKeys: Array.from(pkceStore.keys()),
      aliasKeys: Array.from(pkceAliases.keys())
    });
    return undefined;
  }

  pkceStore.delete(entryKey);
  for (const [alias, target] of pkceAliases.entries()) {
    if (target === entryKey || alias === entryKey) {
      pkceAliases.delete(alias);
    }
  }

  if (entry.expiresAt <= Date.now()) {
    console.warn("PKCE verifier expired", { key: entryKey, expiresAt: entry.expiresAt });
    return undefined;
  }

  console.debug("PKCE verifier consumed", { key: entryKey });
  return entry.verifier;
}

export function storeSalesforceOAuthContext(
  key: string | undefined,
  context: SalesforceOAuthContextEntry,
  options: { alias?: string } = {}
) {
  if (!key) {
    console.warn("storeSalesforceOAuthContext skipped due to missing key");
    return;
  }

  salesforceOAuthContextStore.set(key, context);
  console.debug("Salesforce OAuth context stored", { key, context });

  if (options.alias && options.alias !== key) {
    salesforceOAuthContextAliases.set(options.alias, key);
    console.debug("Salesforce OAuth context alias registered", {
      alias: options.alias,
      key,
    });
  }
}

export function consumeSalesforceOAuthContext(key?: string | null): SalesforceOAuthContextEntry | undefined {
  if (!key) {
    return undefined;
  }

  let entryKey = key;
  let entry = salesforceOAuthContextStore.get(entryKey);

  if (!entry) {
    const aliasTarget = salesforceOAuthContextAliases.get(entryKey);
    if (aliasTarget) {
      entryKey = aliasTarget;
      entry = salesforceOAuthContextStore.get(entryKey);
      console.debug("Salesforce OAuth context resolved via alias", {
        requestedKey: key,
        aliasTarget: entryKey,
        found: !!entry,
      });
    }
  }

  if (!entry) {
    console.warn("Salesforce OAuth context not found", {
      key,
      storeKeys: Array.from(salesforceOAuthContextStore.keys()),
      aliasKeys: Array.from(salesforceOAuthContextAliases.keys()),
    });
    return undefined;
  }

  salesforceOAuthContextStore.delete(entryKey);
  for (const [alias, target] of salesforceOAuthContextAliases.entries()) {
    if (target === entryKey || alias === entryKey) {
      salesforceOAuthContextAliases.delete(alias);
    }
  }

  console.debug("Salesforce OAuth context consumed", { key: entryKey, context: entry });
  return entry;
}

export function extractStateNonce(state?: string | null): string | undefined {
  if (!state) {
    return undefined;
  }

  const tryParse = (value: string) => {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };

  const readNonce = (parsed: any): string | undefined => {
    if (!parsed) return undefined;
    if (typeof parsed.nonce === "string") {
      return parsed.nonce;
    }
    if (typeof parsed.payload === "string") {
      const payload = tryParse(parsed.payload);
      if (payload && typeof payload.nonce === "string") {
        return payload.nonce;
      }
    }
    return undefined;
  };

  const direct = tryParse(state);
  const nonceFromDirect = readNonce(direct);
  if (nonceFromDirect) {
    return nonceFromDirect;
  }

  try {
    const decoded = base64UrlDecode(state);
    if (decoded) {
      const parsed = tryParse(decoded);
      return readNonce(parsed);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function resolveStateForPkce(state?: string | null): { state: string; nonce?: string } {
  if (!state) {
    return createFallbackState();
  }

  const nonce = extractStateNonce(state);
  if (nonce) {
    return { state, nonce };
  }

  return { state };
}

export function getPkceKey({ state, nonce }: { state: string; nonce?: string }): string {
  return nonce || state;
}

interface SalesforceTokenRequest {
  loginUrl: string;
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  codeVerifier?: string;
}

export function buildTokenRequestParams({
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
}: Omit<SalesforceTokenRequest, "loginUrl">): URLSearchParams {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", code);
  params.set("client_id", clientId);

  // Some Salesforce connected app configurations require both PKCE and client secret.
  // Send whichever values are provided instead of treating them as mutually exclusive.
  if (codeVerifier) {
    params.set("code_verifier", codeVerifier);
  }

  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }

  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  return params;
}

export async function requestSalesforceToken(options: SalesforceTokenRequest): Promise<any> {
  const { loginUrl, code, clientId, clientSecret, redirectUri, codeVerifier } = options;
  const tokenUrl = new URL("/services/oauth2/token", loginUrl).toString();
  const bodyParams = buildTokenRequestParams({
    code,
    clientId,
    clientSecret,
    redirectUri,
    codeVerifier,
  });
  const bodyString = bodyParams.toString();
  const paramKeys = Array.from(bodyParams.keys());

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: bodyString,
  });

  if (!response.ok) {
    let errorDetails: any;
    try {
      errorDetails = await response.json();
    } catch {
      try {
        const text = await response.text();
        errorDetails = { error_description: text };
      } catch {
        errorDetails = {};
      }
    }

    const errorMessage = errorDetails?.error_description || errorDetails?.error || "Salesforce token exchange failed";
    console.error("Salesforce token request failed", {
      status: response.status,
      error: errorDetails?.error,
      errorDescription: errorDetails?.error_description,
      params: paramKeys,
    });
    throw new Error(errorMessage);
  }

  return response.json();
}

export function buildSalesforceAuthorizeUrl({
  loginUrl,
  clientId,
  callbackUrl,
  scope,
  state,
  codeChallenge,
}: {
  loginUrl: string;
  clientId: string;
  callbackUrl: string;
  scope: string;
  state: string;
  codeChallenge?: string;
}) {
  const url = new URL("/services/oauth2/authorize", loginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);

  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return url.toString();
}

const DEFAULT_LOGIN_DOMAIN = "https://login.salesforce.com";

const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // refresh one minute before expiry

const SALESFORCE_SCOPE = "api refresh_token";

export function resolveSalesforceUrl(domain?: string): string {
  if (!domain) {
    return DEFAULT_LOGIN_DOMAIN;
  }

  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain.replace(/\/$/, "");
  }

  return `https://${domain.replace(/\/$/, "")}`;
}

export function resolveSalesforceLoginUrl(platform: SalesforcePlatformBase): string {
  const metadataLogin = typeof platform.metadata?.loginUrl === "string" ? platform.metadata.loginUrl.trim() : undefined;
  const domain = typeof platform.domain === "string" ? platform.domain.trim() : undefined;
  const envLogin = typeof process.env.SALESFORCE_LOGIN_URL === "string" ? process.env.SALESFORCE_LOGIN_URL.trim() : undefined;

  return resolveSalesforceUrl(metadataLogin || domain || envLogin);
}

export function getSalesforceCredentials(platform: SalesforcePlatformBase, appKeyOverride?: string, appSecretOverride?: string) {
  const clientId = appKeyOverride || platform.appKey || process.env.SALESFORCE_APP_KEY;
  const clientSecret = appSecretOverride || platform.appSecret || process.env.SALESFORCE_APP_SECRET;

  if (!clientId) {
    throw new Error("Salesforce platform requires an app key in configuration or SALESFORCE_APP_KEY env var");
  }

  if (!clientSecret) {
    throw new Error("Salesforce platform requires an app secret in configuration or SALESFORCE_APP_SECRET env var");
  }

  return { clientId, clientSecret };
}

export async function withSalesforceConnection<T>(options: SalesforceConnectionOptions, action: (connection: Connection) => Promise<T>): Promise<T> {
  const { platform, appKeyOverride, appSecretOverride, redirectUri, onTokenRefresh } = options;
  const { clientId, clientSecret } = getSalesforceCredentials(platform, appKeyOverride, appSecretOverride);

  const loginUrl = resolveSalesforceLoginUrl(platform);
  const instanceUrl = platform.instanceUrl ? resolveSalesforceUrl(platform.instanceUrl) : resolveSalesforceUrl(platform.domain);

  const oauth2 = new OAuth2({
    loginUrl,
    clientId,
    clientSecret,
    redirectUri,
  });

  const connection = new Connection({
    oauth2,
    instanceUrl,
    accessToken: platform.accessToken,
    refreshToken: platform.refreshToken,
  });

  connection.on("refresh", async (accessToken, res) => {
    try {
      await onTokenRefresh?.({
        accessToken,
        refreshToken: res?.refresh_token || platform.refreshToken,
        instanceUrl: res?.instance_url || connection.instanceUrl,
      });
    } catch (error) {
      console.warn("Salesforce token refresh handler failed", error);
    }
  });

  await ensureValidAccessToken(connection, platform);

  return action(connection);
}

async function ensureValidAccessToken(connection: Connection, platform: SalesforcePlatformBase) {
  if (!platform.refreshToken) {
    return;
  }

  const expiresAt = platform.tokenExpiresAt ? new Date(platform.tokenExpiresAt).getTime() : undefined;
  const shouldRefresh = !platform.accessToken || (typeof expiresAt === "number" && expiresAt - Date.now() <= TOKEN_EXPIRY_BUFFER_MS);

  if (!shouldRefresh) {
    return;
  }

  try {
    const tokenResponse = await connection.oauth2.refreshToken(platform.refreshToken);
    connection.accessToken = tokenResponse.access_token;
    connection.refreshToken = tokenResponse.refresh_token || platform.refreshToken;
    if (tokenResponse.instance_url) {
      connection.instanceUrl = tokenResponse.instance_url;
    }
  } catch (error) {
    console.error("Failed to refresh Salesforce access token", error);
    throw new Error("Salesforce access token refresh failed");
  }
}

export function escapeSoqlLike(term: string): string {
  return term.replace(/[\\'_%]/g, (char) => `\\${char}`);
}

export function buildLike(term: string): string {
  return `%${escapeSoqlLike(term)}%`;
}

export function mapQueryPageInfo<T>(response: { done: boolean; nextRecordsUrl?: string | null }): SalesforceQueryPageInfo {
  return {
    hasNextPage: Boolean(response.nextRecordsUrl),
    endCursor: response.nextRecordsUrl || null,
  };
}

export function resolveProductImageUrl(platform: SalesforcePlatformBase, imagePath?: string | null): string | null {
  if (!imagePath) {
    return null;
  }

  const base = resolveSalesforceUrl(platform.domain);
  return `${base}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;
}

export const SALESFORCE_DEFAULT_SCOPES = SALESFORCE_SCOPE;
