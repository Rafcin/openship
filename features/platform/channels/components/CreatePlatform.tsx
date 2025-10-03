"use client";
import React, { useMemo, useState } from "react";
import { useList } from "@/features/dashboard/hooks/useAdminMeta";
import { useCreateItem } from "@/features/dashboard/utils/useCreateItem";
import { enhanceFields } from "@/features/dashboard/utils/enhanceFields";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Fields } from "@/features/dashboard/components/Fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { getFilteredProps } from "../../shops/components/CreatePlatform";

// TODO: Import from actual channel adapters when available
const channelAdapters = {
  shopify: "shopify",
  openfront: "openfront",
  salesforce: "salesforce",
  demo: "demo",
};

const platformHelpText: Record<string, {
  title: string;
  toggles: Array<{ section: string; items: Array<{ label: string; details?: string[] }> }>;
  scopes: string[];
  reminders: string[];
}> = {
  salesforce: {
    title: "Salesforce setup checklist",
    toggles: [
      {
        section: "Flow Enablement",
        items: [
          { label: "Enable Authorization Code and Credentials Flow" },
        ],
      },
      {
        section: "Security",
        items: [
          { label: "Require secret for Web Server Flow" },
          { label: "Require secret for Refresh Token Flow" },
          { label: "Require Proof Key for Code Exchange (PKCE) extension for Supported Authorization Flows" },
        ],
      },
    ],
    scopes: [
      "Manage user data via APIs (api)",
      "Perform requests at any time (refresh_token, offline_access)",
      "Access unique user identifiers (openid)",
    ],
    reminders: [
      "Set the connected app callback URL to the value shown on this form before starting OAuth.",
    ],
  },
};

export function CreatePlatform({ trigger }: { trigger: React.ReactNode }) {
  const [selectedPlatform, setSelectedPlatform] = useState<string | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const router = useRouter();

  const { list } = useList('ChannelPlatform');

  // Create enhanced fields like Keystone does - same pattern as CreatePageClient
  const enhancedFields = useMemo(() => {
    if (!list?.fields) return {}
    return enhanceFields(list.fields, list.key)
  }, [list?.fields, list?.key])

  // Use the create item hook with enhanced fields
  const createItem = useCreateItem(list, enhancedFields);

  const keysToUpdateCustom = [
    "name",
    "createPurchaseFunction",
    "getWebhooksFunction",
    "deleteWebhookFunction",
    "createWebhookFunction",
    "searchProductsFunction",
    "getProductFunction",
    "cancelPurchaseWebhookHandler",
    "createTrackingWebhookHandler",
    "oAuthFunction",
    "oAuthCallbackFunction",
    "appKey",
    "appSecret",
  ];

  const keysToUpdateTemplate = ["name", "appKey", "appSecret"];

  const handlePlatformActivation = async () => {
    if (!createItem) return

    const item = await createItem.create()
    if (item?.id) {
      setIsDialogOpen(false);
      // Refresh the page to show the new platform
      router.refresh();
    }
  };

  const handleTemplateSelection = (value: string) => {
    setSelectedPlatform(value);
    
    // Pre-fill function fields with template slug when a template is selected
    if (value !== "custom" && createItem) {
      const currentValue = createItem.props.value;
      
      // Auto-fill name field for demo
      let nameValue = currentValue.name;
      if (value === "demo") {
        nameValue = { kind: 'create' as const, inner: { kind: 'value' as const, value: "Demo Channel" } };
      }
      
      let functionValues;
      if (value === "demo") {
        // Use localhost docs API routes for demo
        functionValues = {
          searchProductsFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/search-products' } },
          getProductFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/get-product' } },
          createPurchaseFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/create-purchase' } },
          createWebhookFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/create-webhook' } },
          getWebhooksFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/get-webhooks' } },
          deleteWebhookFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/delete-webhook' } },
          cancelPurchaseWebhookHandler: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/webhook-cancel-purchase' } },
          createTrackingWebhookHandler: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/webhook-create-tracking' } },
          oAuthFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/oauth' } },
          oAuthCallbackFunction: { kind: 'create' as const, inner: { kind: 'value' as const, value: 'http://localhost:3000/api/demo/channel/oauth-callback' } },
        };
      } else {
        // Use template slug for other platforms (shopify, etc.)
        const templateValue = { kind: 'create' as const, inner: { kind: 'value' as const, value: value } };
        const emptyValue = { kind: 'create' as const, inner: { kind: 'value' as const, value: "" } };
        
        functionValues = {
          createPurchaseFunction: templateValue,
          getWebhooksFunction: templateValue,
          deleteWebhookFunction: templateValue,
          createWebhookFunction: templateValue,
          searchProductsFunction: templateValue,
          getProductFunction: templateValue,
          cancelPurchaseWebhookHandler: templateValue,
          createTrackingWebhookHandler: templateValue,
          // Leave OAuth functions empty for Shopify since users likely don't have app keys yet
          oAuthFunction: value === 'shopify' ? emptyValue : templateValue,
          oAuthCallbackFunction: value === 'shopify' ? emptyValue : templateValue,
        };
      }
      
      const newValue = {
        ...currentValue,
        name: nameValue,
        ...functionValues,
      };
      createItem.props.onChange(newValue);
    }
  };

  const handleDialogClose = () => {
    setSelectedPlatform(undefined);
    setIsDialogOpen(false);
  };

  const filteredProps = useMemo(() => {
    if (!createItem) return null

    let fieldKeysToShow;
    if (selectedPlatform === "custom") {
      fieldKeysToShow = keysToUpdateCustom;
    } else if (selectedPlatform === "demo") {
      fieldKeysToShow = ["name"]; // Only show name field for demo
    } else {
      fieldKeysToShow = keysToUpdateTemplate;
    }

    const modifications = fieldKeysToShow.map((key) => ({ key }));

    return getFilteredProps(createItem.props, [...modifications], true);
  }, [createItem?.props, selectedPlatform]);

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

    <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Channel Platform</DialogTitle>
          <DialogDescription>
            {selectedPlatform === "custom"
              ? "Create a custom platform from scratch by providing the necessary fields"
              : "Create a platform based on an existing template"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-base pb-2">Platform</Label>
          <Select
            onValueChange={handleTemplateSelection}
            value={selectedPlatform}
          >
            <SelectTrigger className="w-full bg-muted/40 text-base">
              <SelectValue placeholder="Select a platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="-ml-6">Templates</SelectLabel>
                {Object.keys(channelAdapters).map((key) => (
                  <SelectItem
                    key={key}
                    value={key}
                    disabled={channelAdapters[key as keyof typeof channelAdapters] === "soon"}
                  >
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel className="-ml-6">Custom</SelectLabel>
                <SelectItem value="custom">Start from scratch...</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {selectedPlatform && platformHelpText[selectedPlatform] && (
          <Alert className="mt-4">
            <AlertDescription>
              <div className="space-y-4 text-sm">
                <div className="font-medium">
                  {platformHelpText[selectedPlatform].title}
                </div>

                {platformHelpText[selectedPlatform].toggles.map((section) => (
                  <div key={section.section} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.section}
                    </div>
                    <div className="space-y-2">
                      {section.items.map((item) => (
                        <div key={item.label} className="space-y-1">
                          <label className="flex items-center gap-2 text-muted-foreground">
                            <Checkbox
                              checked
                              disabled
                              className="h-4 w-4 border-green-600 data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                            />
                            <span>{item.label}</span>
                          </label>
                          {item.details && (
                            <ul className="list-disc pl-6 text-xs text-muted-foreground space-y-1">
                              {item.details.map((detail) => (
                                <li key={detail}>{detail}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    OAuth scopes
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    {platformHelpText[selectedPlatform].scopes.map((scope) => (
                      <li key={scope}>
                        <code>{scope}</code>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1 text-muted-foreground">
                  {platformHelpText[selectedPlatform].reminders.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {selectedPlatform && (
          <div className="bg-muted/20 p-4 border rounded-lg overflow-auto max-h-[50vh]">
            {createItem?.error && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {createItem.error.networkError?.message ||
                   createItem.error.graphQLErrors?.[0]?.message ||
                   'An error occurred while creating the platform'
                  }
                </AlertDescription>
              </Alert>
            )}
            <Fields {...filteredProps} />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleDialogClose}
          >
            Cancel
          </Button>
          <Button
            disabled={!selectedPlatform || createItem?.state === "loading"}
            onClick={handlePlatformActivation}
          >
            {createItem?.state === "loading" ? "Creating..." : "Create Platform"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
