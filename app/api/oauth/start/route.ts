import { NextResponse } from "next/server";
import { OAuth2 } from "jsforce";

function resolveLoginUrl() {
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
  if (!process.env.SALESFORCE_LOGIN_URL) {
    console.warn("SALESFORCE_LOGIN_URL env var missing; defaulting to https://login.salesforce.com");
  }
  return loginUrl;
}

function resolveRedirectUri() {
  const redirectUri = process.env.SALESFORCE_REDIRECT_URI || "http://localhost:3000/api/oauth/callback";
  if (!process.env.SALESFORCE_REDIRECT_URI) {
    console.warn("SALESFORCE_REDIRECT_URI env var missing; defaulting to http://localhost:3000/api/oauth/callback");
  }
  return redirectUri;
}

export async function GET() {
  if (!process.env.SALESFORCE_APP_KEY) {
    throw new Error("SALESFORCE_APP_KEY env var is required");
  }
  if (!process.env.SALESFORCE_APP_SECRET) {
    throw new Error("SALESFORCE_APP_SECRET env var is required");
  }

  const oauth2 = new OAuth2({
    loginUrl: resolveLoginUrl(),
    clientId: process.env.SALESFORCE_APP_KEY,
    clientSecret: process.env.SALESFORCE_APP_SECRET,
    redirectUri: resolveRedirectUri(),
  });

  const authUrl = oauth2.getAuthorizationUrl({
    scope: "api refresh_token",
  });

  return NextResponse.redirect(authUrl);
}
