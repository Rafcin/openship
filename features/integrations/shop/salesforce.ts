import { Connection, OAuth2 } from "jsforce";
import {
  SALESFORCE_DEFAULT_SCOPES,
  SalesforcePlatformBase,
  buildLike,
  mapQueryPageInfo,
  resolveProductImageUrl,
  buildSalesforceAuthorizeUrl,
  consumePkceVerifier,
  generatePkce,
  getPkceKey,
  resolveStateForPkce,
  storeSalesforceOAuthContext,
  storePkceVerifier,
  consumeSalesforceOAuthContext,
  resolveSalesforceLoginUrl,
  resolveSalesforceUrl,
  withSalesforceConnection,
} from "../salesforce/common";

interface SalesforceShopPlatform extends SalesforcePlatformBase {
  accountId?: string;
  state?: string;
}

interface SearchProductsArgs {
  searchEntry: string;
  after?: string;
}

interface GetProductArgs {
  productId: string;
  variantId?: string;
}

interface SearchOrdersArgs {
  searchEntry: string;
  after?: string;
}

interface UpdateProductArgs {
  productId: string;
  variantId?: string;
  inventory?: number;
  price?: string | number;
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

const DEFAULT_WEBHOOK_QUERY = "SELECT Id, OrderNumber, Status, TotalAmount, EffectiveDate, LastModifiedDate FROM Order";

const SHOP_SCOPES = SALESFORCE_DEFAULT_SCOPES;

const PUSH_TOPIC_PREFIX = "Openship_Order_";

const API_VERSION = "60.0";

export function scopes() {
  return SHOP_SCOPES;
}

type PricebookEntryRecord = {
  Id: string;
  UnitPrice?: number;
  CurrencyIsoCode?: string;
};

async function getStandardPricebookId(connection: Connection): Promise<string> {
  const result = await connection.query<{ Id: string }>("SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1");
  if (!result.records.length) {
    throw new Error("Salesforce requires a standard pricebook; none found");
  }
  return result.records[0].Id;
}

async function ensurePricebookEntry(connection: Connection, pricebookId: string, productId: string, unitPrice?: number): Promise<string> {
  const existing = await connection.query<{ Id: string }>(
    `SELECT Id FROM PricebookEntry WHERE Pricebook2Id = '${pricebookId}' AND Product2Id = '${productId}' LIMIT 1`
  );

  if (existing.records.length) {
    if (typeof unitPrice === "number") {
      await connection.sobject("PricebookEntry").update({ Id: existing.records[0].Id, UnitPrice: unitPrice });
    }
    return existing.records[0].Id;
  }

  const price = typeof unitPrice === "number" ? unitPrice : 0;
  const createResult = await connection.sobject("PricebookEntry").create({
    Pricebook2Id: pricebookId,
    Product2Id: productId,
    UnitPrice: price,
    UseStandardPrice: typeof unitPrice === "number" ? false : true,
    IsActive: true,
  });

  if (!createResult.success) {
    throw new Error(`Failed to ensure pricebook entry for product ${productId}`);
  }

  return createResult.id as string;
}

export async function searchProductsFunction({ platform, searchEntry, after }: { platform: SalesforceShopPlatform; searchEntry: string; after?: string; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const soql = `SELECT Id, Name, ProductCode, Description, Family, IsActive, StockKeepingUnit, QuantityUnitOfMeasure,
      (SELECT Id, UnitPrice, CurrencyIsoCode FROM PricebookEntries WHERE IsActive = true ORDER BY CreatedDate DESC LIMIT 1)
      FROM Product2
      WHERE Name LIKE '${buildLike(searchEntry)}' OR ProductCode LIKE '${buildLike(searchEntry)}'
      ORDER BY LastModifiedDate DESC LIMIT 50`;

    const result = after ? await connection.queryMore( after ) : await connection.query<any>(soql);
    const records = result.records || [];

    const products = records.map((record: any) => {
      const pricebookEntries = record.PricebookEntries?.records || record.PricebookEntries || [];
      const priceEntry = pricebookEntries[0] as PricebookEntryRecord | undefined;

      return {
        image: resolveProductImageUrl(platform, record.ExternalImageURL__c || null),
        title: record.Name,
        productId: record.Id,
        variantId: record.StockKeepingUnit || record.ProductCode || record.Id,
        price: priceEntry?.UnitPrice ?? null,
        availableForSale: Boolean(record.IsActive),
        inventory: record.QuantityOnHand ?? null,
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

export async function getProductFunction({ platform, productId }: { platform: SalesforceShopPlatform; productId: string; variantId?: string; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const soql = `SELECT Id, Name, ProductCode, Description, Family, IsActive, StockKeepingUnit, QuantityOnHand,
      QuantityUnitOfMeasure, ExternalImageURL__c,
      (SELECT Id, UnitPrice, CurrencyIsoCode FROM PricebookEntries WHERE IsActive = true ORDER BY CreatedDate DESC LIMIT 1)
      FROM Product2 WHERE Id = '${productId}' LIMIT 1`;

    const result = await connection.query<any>(soql);
    if (!result.records.length) {
      throw new Error(`Salesforce product ${productId} not found`);
    }

    const record = result.records[0];
    const priceEntry = (record.PricebookEntries?.records || record.PricebookEntries || [])[0] as PricebookEntryRecord | undefined;

    return {
      productId: record.Id,
      variantId: record.StockKeepingUnit || record.ProductCode || record.Id,
      title: record.Name,
      description: record.Description,
      price: priceEntry?.UnitPrice ?? null,
      availableForSale: Boolean(record.IsActive),
      inventory: record.QuantityOnHand ?? null,
      inventoryTracked: true,
      productLink: `${resolveSalesforceUrl(platform.domain)}/lightning/r/Product2/${record.Id}/view`,
      image: resolveProductImageUrl(platform, record.ExternalImageURL__c || null),
    };
  });
}

export async function searchOrdersFunction({ platform, searchEntry, after }: { platform: SalesforceShopPlatform; searchEntry: string; after?: string; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const soql = `SELECT Id, OrderNumber, Status, TotalAmount, EffectiveDate, CreatedDate, LastModifiedDate,
      AccountId, Account.Name,
      ShippingStreet, ShippingCity, ShippingState, ShippingPostalCode, ShippingCountry,
      (SELECT Id, Quantity, UnitPrice, Description, Product2Id, PricebookEntryId FROM OrderItems)
      FROM Order
      WHERE OrderNumber LIKE '${buildLike(searchEntry)}' OR Id LIKE '${buildLike(searchEntry)}'
      ORDER BY LastModifiedDate DESC LIMIT 50`;

    const result = after ? await connection.queryMore(after) : await connection.query<any>(soql);
    const records = result.records || [];

    const orders = records.map((record: any) => ({
      id: record.Id,
      orderName: record.OrderNumber,
      status: record.Status,
      totalPrice: record.TotalAmount,
      createdAt: record.CreatedDate,
      updatedAt: record.LastModifiedDate,
      shipping: {
        address1: record.ShippingStreet,
        city: record.ShippingCity,
        province: record.ShippingState,
        zip: record.ShippingPostalCode,
        country: record.ShippingCountry,
      },
      accountId: record.AccountId,
      accountName: record.Account?.Name,
      lineItems: (record.OrderItems?.records || record.OrderItems || []).map((item: any) => ({
        id: item.Id,
        quantity: item.Quantity,
        price: item.UnitPrice,
        description: item.Description,
        productId: item.Product2Id,
        pricebookEntryId: item.PricebookEntryId,
      })),
    }));

    return {
      orders,
      pageInfo: mapQueryPageInfo(result),
    };
  });
}

export async function updateProductFunction({ platform, productId, inventory, price }: UpdateProductArgs) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const updates: string[] = [];

    if (typeof inventory === "number") {
      const inventoryField = platform.metadata?.inventoryField || "Quantity__c";
      try {
        await connection.sobject("Product2").update({ Id: productId, [inventoryField]: inventory });
        updates.push("inventory");
      } catch (error) {
        console.warn(`Salesforce inventory update failed for ${productId}`, error);
      }
    }

    if (typeof price !== "undefined") {
      const numericPrice = typeof price === "string" ? parseFloat(price) : price;
      if (Number.isFinite(numericPrice)) {
        const pricebookId = platform.metadata?.pricebookId || (await getStandardPricebookId(connection));
        await ensurePricebookEntry(connection, pricebookId, productId, Number(numericPrice));
        updates.push("price");
      }
    }

    return {
      success: updates.length > 0,
      updated: updates,
    };
  });
}

export async function createWebhookFunction({ platform, endpoint, events }: { platform: SalesforceShopPlatform; endpoint: string; events: string[]; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const notifyOnCreate = events.includes("ORDER_CREATED");
    const notifyOnUpdate = events.includes("ORDER_UPDATED") || events.includes("TRACKING_CREATED");
    const notifyOnDelete = events.includes("ORDER_CANCELLED");

    const name = `${PUSH_TOPIC_PREFIX}${Date.now()}`.slice(0, 80);

    const createResult = await connection.sobject("PushTopic").create({
      Name: name,
      Query: DEFAULT_WEBHOOK_QUERY,
      ApiVersion: API_VERSION,
      NotifyForFields: "Referenced",
      NotifyForOperationCreate: notifyOnCreate,
      NotifyForOperationUpdate: notifyOnUpdate,
      NotifyForOperationDelete: notifyOnDelete,
      NotifyForOperationUndelete: false,
    });

    if (!createResult.success) {
      throw new Error("Failed to create Salesforce PushTopic webhook");
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

export async function deleteWebhookFunction({ platform, webhookId }: { platform: SalesforceShopPlatform; webhookId: string; }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    await connection.sobject("PushTopic").destroy(webhookId);
    return { success: true };
  });
}

export async function getWebhooksFunction({ platform }: { platform: SalesforceShopPlatform }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const result = await connection.query<any>(
      `SELECT Id, Name, Query, ApiVersion, NotifyForFields FROM PushTopic WHERE Name LIKE '${PUSH_TOPIC_PREFIX}%'`
    );

    return result.records.map((record: any) => ({
      id: record.Id,
      name: record.Name,
      query: record.Query,
      apiVersion: record.ApiVersion,
      notifyForFields: record.NotifyForFields,
    }));
  });
}

export async function oAuthFunction({ platform, callbackUrl }: { platform: SalesforceShopPlatform; callbackUrl: string }) {
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

  console.debug("[Salesforce Shop OAuth] Prepared authorize request", {
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
    scope: SHOP_SCOPES,
    state: resolvedState.state,
    codeChallenge: challenge,
  });

  console.debug("[Salesforce Shop OAuth] PKCE challenge generated", {
    pkceKey,
    authUrlPreview: authUrl.slice(0, 120),
  });

  return { authUrl, state: resolvedState.state };
}

export async function oAuthCallbackFunction({ platform, code, state, redirectUri, appKey, appSecret }: OAuthCallbackArgs & { platform: SalesforceShopPlatform }) {
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
    console.warn("[Salesforce Shop OAuth] OAuth context not found", {
      pkceKey,
      statePreview: resolvedState.state?.slice(0, 12),
    });
  }

  const effectivePlatform: SalesforceShopPlatform = {
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
    console.warn("[Salesforce Shop OAuth] No PKCE code verifier found for token exchange", {
      pkceKey,
      statePreview: resolvedState.state?.slice(0, 12),
    });
  }

  console.debug("[Salesforce Shop OAuth] Prepared token request", {
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

  console.debug("[Salesforce Shop OAuth] Token response received", {
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
    // Fallback to dummy data if identity call fails
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

export async function createOrderWebhookHandler({ platform, event }: { platform: SalesforceShopPlatform; event: any; headers: Record<string, string> }) {
  const order = event?.sobject || event?.payload || event;
  if (!order?.Id) {
    throw new Error("Salesforce webhook payload missing order data");
  }

  const shippingStreet = order.ShippingStreet || order.ShippingAddress?.street;
  const shippingCity = order.ShippingCity || order.ShippingAddress?.city;
  const shippingState = order.ShippingState || order.ShippingAddress?.state;
  const shippingPostalCode = order.ShippingPostalCode || order.ShippingAddress?.postalCode;
  const shippingCountry = order.ShippingCountry || order.ShippingAddress?.country;

  const lineItems = (order.OrderItems || order.items || []).map((item: any) => ({
    name: item.Description || item.Name,
    price: item.UnitPrice,
    quantity: item.Quantity,
    productId: item.Product2Id,
    variantId: item.PricebookEntryId,
    lineItemId: item.Id,
  }));

  return {
    orderId: order.Id,
    orderName: order.OrderNumber,
    email: order.CustomerAuthorizedById ? undefined : order.BillToContact?.Email,
    firstName: order.BillToContact?.FirstName,
    lastName: order.BillToContact?.LastName,
    streetAddress1: shippingStreet,
    city: shippingCity,
    state: shippingState,
    zip: shippingPostalCode,
    country: shippingCountry,
    phone: order.BillToContact?.Phone,
    currency: order.CurrencyIsoCode,
    totalPrice: order.TotalAmount,
    subTotalPrice: order.SubtotalAmount,
    totalDiscounts: order.TotalLineItemAmount ? order.TotalLineItemAmount - order.TotalAmount : undefined,
    totalTax: order.TotalTaxAmount,
    status: order.Status,
    linkOrder: true,
    matchOrder: true,
    processOrder: true,
    lineItems: { create: lineItems },
  };
}

export async function cancelOrderWebhookHandler({ event }: WebhookEventArgs) {
  const order = event?.sobject || event;
  if (!order?.Id) {
    throw new Error("Salesforce cancel webhook payload missing order data");
  }

  return {
    order: {
      id: order.Id,
      name: order.OrderNumber,
      cancelReason: order.CancelledReason || "unspecified",
      cancelledAt: new Date().toISOString(),
    },
    type: "order_cancelled",
  };
}

export async function addTrackingFunction({ platform, order, trackingCompany, trackingNumber }: { platform: SalesforceShopPlatform; order: any; trackingCompany: string; trackingNumber: string }) {
  return withSalesforceConnection({ platform }, async (connection) => {
    const trackingNumberField = platform.metadata?.trackingNumberField || "TrackingNumber__c";
    const trackingCarrierField = platform.metadata?.trackingCarrierField || "TrackingCarrier__c";

    const update: Record<string, any> = {
      Id: order.orderId,
      [trackingNumberField]: trackingNumber,
      [trackingCarrierField]: trackingCompany,
    };

    await connection.sobject("Order").update(update);

    return { success: true };
  });
}
