# Salesforce Platform Templates

These adapters provide baseline Salesforce integrations for Openship platform templates. They mirror the existing Shopify/OpenFront conventions so shop and channel instances can be scaffolded quickly.

## Supported capabilities

- OAuth 2.0 (authorization code grant) using the project `APP_KEY` / `APP_SECRET` pattern (`SALESFORCE_APP_KEY` / `SALESFORCE_APP_SECRET` fallbacks).
- GraphQL-style helpers that wrap common SOQL queries for products and orders.
- Minimal upsert helpers for `Product2`, `PricebookEntry`, `Order`, and `OrderItem` records.
- PushTopic-based webhook management for downstream order/fulfillment notifications.
- Tracking updates that write back to configurable `Order` fields.

## Configuration

| Setting | Description |
| --- | --- |
| `domain` | Salesforce instance domain or My Domain URL, used for REST calls and deep links. |
| `appKey` / `appSecret` | Connected App credentials; optional when environment variables `SALESFORCE_APP_KEY` / `SALESFORCE_APP_SECRET` are set. |
| `metadata.loginUrl` | Optional override for authorization/login host (defaults to `domain` or `https://login.salesforce.com`). |
| `metadata.pricebookId` | Channel-only override for the Pricebook used when creating `OrderItem` rows. |
| `metadata.accountId` | Channel-only default Account used for created Orders. |
| `metadata.inventoryField` | Shop-only field name on `Product2` to receive inventory updates (defaults to `Quantity__c`). |
| `metadata.trackingNumberField` / `metadata.trackingCarrierField` | Shop tracking field overrides (defaults to custom fields `TrackingNumber__c` / `TrackingCarrier__c`). |

## Connected App checklist

Configure your Salesforce Connected App with these settings before running OAuth:

- Enable **Authorization Code and Credentials Flow** (Flow Enablement).
- Require secret for **Web Server Flow** (Security).
- Require secret for **Refresh Token Flow** (Security).
- Require **Proof Key for Code Exchange (PKCE)** for supported authorization flows (Security).

Other Connected App options can remain disabled. Remember to set the callback URL to the value surfaced in the Openship UI (typically `https://<your-app>/api/oauth/callback`).

## Notes

- Webhooks use PushTopics for parity with other templates. Replace with Change Data Capture or Platform Events if preferred.
- Order item pricing relies on the Standard Price Book when a specific `pricebookId` is not provided.
- JWT / server-to-server auth flows are left as TODOs for future iterations.
