import { Connection, OAuth2 } from "jsforce";
import {
  SALESFORCE_DEFAULT_SCOPES,
  SalesforcePlatformBase,
  buildLike,
  mapQueryPageInfo,
  buildSalesforceAuthorizeUrl,
  consumePkceVerifier,
  consumeSalesforceOAuthContext,
  generatePkce,
  getPkceKey,
  resolveStateForPkce,
  storeSalesforceOAuthContext,
  storePkceVerifier,
  resolveSalesforceLoginUrl,
  resolveSalesforceUrl,
  withSalesforceConnection,
} from "../salesforce/common";

interface SalesforceChannelPlatform extends SalesforcePlatformBase {
  fulfillmentAccountId?: string;
  pricebookId?: string;
  state?: string;
}

interface SearchProductsArgs {
  searchEntry: string;
  after?: string;
}

interface GetProductArgs {
  productId: string;
}

interface CreatePurchaseArgs {
  cartItems: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    price?: number | string;
    name?: string;
  }>;
  shipping?: {
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
    phone?: string;
    email?: string;
  };
  notes?: string;
}

interface CreateWebhookArgs {
  endpoint: string;
  events: string[];
}

interface DeleteWebhookArgs {
  webhookId: string;
}

interface OAuthArgs {
  callbackUrl: string;
}

interface OAuthCallbackArgs {
  code?: string;
  state?: string;
  appKey?: string;
  appSecret?: string;
  redirectUri?: string;
}

interface WebhookEventArgs {
  event: any;
  headers: Record<string, string>;
}

const PUSH_TOPIC_PREFIX = "Openship_Fulfillment_";
const API_VERSION = "60.0";
const CHANNEL_SCOPES = SALESFORCE_DEFAULT_SCOPES;

export function scopes() {
  return CHANNEL_SCOPES;
}

async function ensurePricebookEntry(connection: Connection, pricebookId: string, productId: string, price?: number): Promise<string> {
  const result = await connection.query<{ Id: string }>(
    `SELECT Id FROM PricebookEntry WHERE Pricebook2Id = '${pricebookId}' AND Product2Id = '${productId}' LIMIT 1`
  );

  if (result.records.length) {
    if (typeof price === "number") {
      await connection.sobject("PricebookEntry").update({ Id: result.records[0].Id, UnitPrice: price });
    }
    return result.records[0].Id;
  }

  const createResult = await connection.sobject("PricebookEntry").create({
    Pricebook2Id: pricebookId,
    Product2Id: productId,
    UnitPrice: typeof price === "number" ? price : 0,
    UseStandardPrice: typeof price === "number" ? false : true,
    IsActive: true,
  });

  if (!createResult.success) {
    throw new Error(`Failed to prepare pricebook entry for product ${productId}`);
  }

  return createResult.id as string;
}

async function resolveFulfillmentPricebook(connection: Connection, platform: SalesforceChannelPlatform): Promise<string> {
  if (platform.pricebookId) {
    return platform.pricebookId;
  }

  const result = await connection.query<{ Id: string }>("SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1");
  if (!result.records.length) {
    throw new Error("Salesforce requires a pricebook to create purchases");
  }
  return result.records[0].Id;
}

export async function searchProductsFunction({ platform, searchEntry, after }: { platform: SalesforceChannelPlatform; searchEntry: string; after?: string; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const soql = `SELECT Id, Name, ProductCode, Description, Family, IsActive,
      (SELECT Id, UnitPrice, CurrencyIsoCode FROM PricebookEntries WHERE IsActive = true ORDER BY CreatedDate DESC LIMIT 1)
      FROM Product2
      WHERE Name LIKE '${buildLike(searchEntry)}' OR ProductCode LIKE '${buildLike(searchEntry)}'
      ORDER BY LastModifiedDate DESC LIMIT 50`;

    const result = after ? await connection.queryMore(after) : await connection.query<any>(soql);
    const records = result.records || [];

    const products = records.map((record: any) => {
      const priceEntry = (record.PricebookEntries?.records || record.PricebookEntries || [])[0];
      return {
        title: record.Name,
        productId: record.Id,
        variantId: record.ProductCode || record.Id,
        price: priceEntry?.UnitPrice ?? null,
        availableForSale: Boolean(record.IsActive),
        inventory: null,
        inventoryTracked: true,
        productLink: `${resolveSalesforceUrl(platform.domain)}/lightning/r/Product2/${record.Id}/view`,
        cursor: record.Id,
      };
    });

    return {
      products,
      pageInfo: mapQueryPageInfo(result),
    };
  });
}

export async function getProductFunction({ platform, productId }: GetProductArgs & { platform: SalesforceChannelPlatform }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const soql = `SELECT Id, Name, ProductCode, Description, Family,
      (SELECT Id, UnitPrice FROM PricebookEntries WHERE IsActive = true ORDER BY CreatedDate DESC LIMIT 1)
      FROM Product2 WHERE Id = '${productId}' LIMIT 1`;

    const result = await connection.query<any>(soql);
    if (!result.records.length) {
      throw new Error(`Salesforce product ${productId} not found`);
    }

    const record = result.records[0];
    const priceEntry = (record.PricebookEntries?.records || record.PricebookEntries || [])[0];

    return {
      productId: record.Id,
      variantId: record.ProductCode || record.Id,
      title: record.Name,
      description: record.Description,
      price: priceEntry?.UnitPrice ?? null,
      availableForSale: Boolean(record.IsActive),
      productLink: `${resolveSalesforceUrl(platform.domain)}/lightning/r/Product2/${record.Id}/view`,
    };
  });
}

export async function createPurchaseFunction({ platform, cartItems, shipping, notes }: CreatePurchaseArgs & { platform: SalesforceChannelPlatform }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const accountId = platform.fulfillmentAccountId || platform.metadata?.accountId;
    if (!accountId) {
      throw new Error("Salesforce channel platform requires a fulfillment accountId in configuration metadata");
    }

    const pricebookId = await resolveFulfillmentPricebook(connection, platform);

    const orderCreate = await connection.sobject("Order").create({
      AccountId: accountId,
      Status: "Draft",
      EffectiveDate: new Date().toISOString().split("T")[0],
      Description: notes,
      Pricebook2Id: pricebookId,
      ShippingStreet: shipping?.address1,
      ShippingCity: shipping?.city,
      ShippingState: shipping?.province,
      ShippingPostalCode: shipping?.zip,
      ShippingCountry: shipping?.country,
      CustomerAuthorizedById: platform.metadata?.authorizedContactId,
    });

    if (!orderCreate.success) {
      throw new Error("Failed to create Salesforce order for purchase");
    }

    const orderId = orderCreate.id as string;

    for (const item of cartItems) {
      const numericPrice = typeof item.price === "string" ? parseFloat(item.price) : item.price;
      const pricebookEntryId = await ensurePricebookEntry(connection, pricebookId, item.productId, Number.isFinite(numericPrice) ? Number(numericPrice) : undefined);

      await connection.sobject("OrderItem").create({
        OrderId: orderId,
        PricebookEntryId: pricebookEntryId,
        Quantity: item.quantity,
        UnitPrice: Number.isFinite(numericPrice) ? Number(numericPrice) : undefined,
        Description: item.name,
      });
    }

    return {
      purchaseId: orderId,
      url: `${resolveSalesforceUrl(platform.domain)}/lightning/r/Order/${orderId}/view`,
    };
  });
}

export async function createWebhookFunction({ platform, endpoint, events }: { platform: SalesforceChannelPlatform; endpoint: string; events: string[]; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const notifyOnCreate = events.includes("FULFILLMENT_CREATED") || events.includes("ORDER_CREATED");
    const notifyOnUpdate = events.includes("TRACKING_CREATED") || events.includes("FULFILLMENT_UPDATED");
    const notifyOnDelete = events.includes("ORDER_CANCELLED");

    const name = `${PUSH_TOPIC_PREFIX}${Date.now()}`.slice(0, 80);

    const createResult = await connection.sobject("PushTopic").create({
      Name: name,
      Query: "SELECT Id, Status, TotalAmount FROM Order",
      ApiVersion: API_VERSION,
      NotifyForFields: "Referenced",
      NotifyForOperationCreate: notifyOnCreate,
      NotifyForOperationUpdate: notifyOnUpdate,
      NotifyForOperationDelete: notifyOnDelete,
      NotifyForOperationUndelete: false,
    });

    if (!createResult.success) {
      throw new Error("Failed to create Salesforce channel webhook");
    }

    return {
      webhookId: createResult.id,
      webhooks: [
        {
          id: createResult.id,
          name,
          endpoint,
          events,
        },
      ],
    };
  });
}

export async function deleteWebhookFunction({ platform, webhookId }: { platform: SalesforceChannelPlatform; webhookId: string; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    await connection.sobject("PushTopic").destroy(webhookId);
    return { success: true };
  });
}

export async function getWebhooksFunction({ platform }: { platform: SalesforceChannelPlatform }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const result = await connection.query<any>(
      `SELECT Id, Name, Query, ApiVersion FROM PushTopic WHERE Name LIKE '${PUSH_TOPIC_PREFIX}%'`
    );

    return result.records.map((record: any) => ({
      id: record.Id,
      name: record.Name,
      query: record.Query,
      apiVersion: record.ApiVersion,
    }));
  });
}

export async function oAuthFunction({ platform, callbackUrl }: { platform: SalesforceChannelPlatform; callbackUrl: string }) {
  const loginUrl = resolveSalesforceLoginUrl(platform);

  const clientId = platform.appKey || process.env.SALESFORCE_APP_KEY;
  const clientSecret = platform.appSecret || process.env.SALESFORCE_APP_SECRET;

  if (!clientId) {
    throw new Error("Salesforce OAuth requires appKey (Consumer Key)");
  }

  if (!clientSecret) {
    throw new Error("Salesforce OAuth requires appSecret (Consumer Secret)");
  }

  const resolvedState = resolveStateForPkce(platform.state);
  const { verifier, challenge } = generatePkce();
  const pkceKey = getPkceKey(resolvedState);
  storePkceVerifier(pkceKey, verifier, { alias: resolvedState.state });
  storeSalesforceOAuthContext(
    pkceKey,
    {
      domain: platform.domain,
      loginUrl,
      metadataLoginUrl: platform.metadata?.loginUrl,
    },
    { alias: resolvedState.state }
  );

  console.debug("[Salesforce Channel OAuth] Prepared authorize request", {
    loginUrl,
    callbackUrl,
    statePreview: resolvedState.state?.slice(0, 12),
    hasState: Boolean(resolvedState.state),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    pkceKeyHasNonce: Boolean(resolvedState.nonce),
  });

  const authUrl = buildSalesforceAuthorizeUrl({
    loginUrl,
    clientId,
    callbackUrl,
    scope: CHANNEL_SCOPES,
    state: resolvedState.state,
    codeChallenge: challenge,
  });

  console.debug("[Salesforce Channel OAuth] PKCE challenge generated", {
    pkceKey,
    authUrlPreview: authUrl.slice(0, 120),
  });

  return { authUrl, state: resolvedState.state };
}

export async function oAuthCallbackFunction({ platform, code, state, redirectUri, appKey, appSecret }: OAuthCallbackArgs & { platform: SalesforceChannelPlatform }) {
  if (!code) {
    throw new Error("Salesforce OAuth callback requires authorization code");
  }

  const clientId = appKey || platform.appKey || process.env.SALESFORCE_APP_KEY;
  const clientSecret = appSecret || platform.appSecret || process.env.SALESFORCE_APP_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Salesforce OAuth callback requires Consumer Key/Secret");
  }

  const resolvedState = resolveStateForPkce(state || platform.state);
  const pkceKey = getPkceKey(resolvedState);
  const codeVerifier = consumePkceVerifier(pkceKey) || consumePkceVerifier(resolvedState.state);
  let oauthContext = consumeSalesforceOAuthContext(pkceKey);
  if (!oauthContext && resolvedState.state) {
    oauthContext = consumeSalesforceOAuthContext(resolvedState.state);
  }

  if (!oauthContext) {
    console.warn("[Salesforce Channel OAuth] OAuth context not found", {
      pkceKey,
      statePreview: resolvedState.state?.slice(0, 12),
    });
  }

  const effectivePlatform: SalesforceChannelPlatform = {
    ...platform,
    domain: oauthContext?.domain || platform.domain,
    metadata: {
      ...(platform.metadata || {}),
      ...(oauthContext?.metadataLoginUrl ? { loginUrl: oauthContext.metadataLoginUrl } : {}),
    },
  };

  const loginUrl = oauthContext?.loginUrl || resolveSalesforceLoginUrl(effectivePlatform);

  const tokenUrl = new URL("/services/oauth2/token", loginUrl).toString();
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", code);
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("redirect_uri", redirectUri || process.env.SALESFORCE_REDIRECT_URI || "");
  if (codeVerifier) {
    params.set("code_verifier", codeVerifier);
  }

  if (!codeVerifier) {
    console.warn("[Salesforce Channel OAuth] No PKCE code verifier found for token exchange", {
      pkceKey,
      statePreview: resolvedState.state?.slice(0, 12),
    });
  }

  console.debug("[Salesforce Channel OAuth] Prepared token request", {
    loginUrl,
    tokenUrl,
    effectiveDomain: effectivePlatform.domain,
    usedOAuthContext: Boolean(oauthContext),
    paramSummary: {
      grantType: params.get("grant_type"),
      hasCode: Boolean(params.get("code")),
      codeLength: params.get("code")?.length,
      hasClientId: Boolean(params.get("client_id")),
      hasClientSecret: Boolean(params.get("client_secret")),
      redirectUri: params.get("redirect_uri"),
      hasCodeVerifier: Boolean(codeVerifier),
    },
    pkceKey,
    statePreview: resolvedState.state?.slice(0, 12),
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: params.toString(),
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
    });
    throw new Error(errorMessage);
  }

  const tokenData = await response.json();

  console.debug("[Salesforce Channel OAuth] Token response received", {
    instanceUrl: tokenData.instance_url,
    hasRefreshToken: Boolean(tokenData.refresh_token),
    scope: tokenData.scope,
    issuedAt: tokenData.issued_at,
  });

  const oauth2 = new OAuth2({
    loginUrl,
    clientId,
    clientSecret,
    redirectUri: redirectUri || process.env.SALESFORCE_REDIRECT_URI,
  });

  const connection = new Connection({
    oauth2,
    instanceUrl: tokenData.instance_url,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
  });

  let userInfo: any;
  try {
    userInfo = await connection.identity();
  } catch (error) {
    console.warn("Salesforce identity lookup failed", error instanceof Error ? error.message : error);
    userInfo = {
      id: tokenData.id || 'unknown',
      organizationId: 'unknown',
      issued_at: tokenData.issued_at || new Date().toISOString(),
    };
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    domain: tokenData.instance_url || loginUrl,
    instanceUrl: tokenData.instance_url,
    userId: userInfo.id,
    organizationId: userInfo.organizationId,
    issuedAt: userInfo.issued_at || tokenData.issued_at,
  };
}

export async function createTrackingWebhookHandler({ event }: WebhookEventArgs & { platform: SalesforceChannelPlatform }) {
  const payload = event?.sobject || event;
  if (!payload?.Id) {
    throw new Error("Salesforce tracking webhook payload missing order data");
  }

  const trackingNumber = payload.TrackingNumber__c || payload.TrackingId__c || payload.TrackingNumber;
  const carrier = payload.TrackingCarrier__c || payload.Carrier__c || payload.Carrier;

  return {
    orderId: payload.Id,
    status: payload.Status,
    tracking: {
      number: trackingNumber,
      carrier,
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function cancelPurchaseWebhookHandler({ event }: WebhookEventArgs) {
  const payload = event?.sobject || event;
  if (!payload?.Id) {
    throw new Error("Salesforce cancel webhook payload missing order data");
  }

  return {
    order: {
      id: payload.Id,
      name: payload.OrderNumber,
      cancelReason: payload.CancelledReason || "unspecified",
      cancelledAt: new Date().toISOString(),
    },
    type: "order_cancelled",
  };
}
