"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createChannel } from "../actions/createChannel";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreateChannelFromURLProps {
  onChannelCreated?: () => void;
  searchParams?: {
    showCreateChannel?: string;
    showCreateChannelAndChannelAndPlatform?: string;
    platform?: string;
    accessToken?: string;
    domain?: string;
    platformInitiated?: string;
    // OAuth parameters from marketplace flow
    client_id?: string;
    client_secret?: string;
    app_name?: string;
    adapter_slug?: string; // Identifies which adapter to use (e.g., 'openfront', 'shopify')
    code?: string;
    scope?: string;
    redirect_uri?: string;
    state?: string;
    // Token parameters from OAuth callback
    refreshToken?: string;
    tokenExpiresAt?: string;
  };
}

export function CreateChannelFromURL({ onChannelCreated, searchParams }: CreateChannelFromURLProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  
  // Form fields - pre-filled from URL params
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [platformId, setPlatformId] = useState('');
  const [isPlatformInitiated, setIsPlatformInitiated] = useState(false);
  const [isMarketplaceFlow, setIsMarketplaceFlow] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [appName, setAppName] = useState('');
  const [adapterSlug, setAdapterSlug] = useState('');
  const [oauthCode, setOauthCode] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState('');

  useEffect(() => {
    if (!searchParams || !searchParams.showCreateChannel) return;
    
    const { 
      platform: urlPlatform, 
      accessToken: urlAccessToken, 
      domain: urlDomain,
      client_id,
      client_secret,
      app_name,
      adapter_slug,
      code,
      refreshToken: urlRefreshToken,
      tokenExpiresAt: urlTokenExpiresAt,
      platformInitiated
    } = searchParams;

    if (!urlDomain) return;

    console.log('CreateChannelFromURL - Processing OAuth callback:', {
      hasClientId: !!client_id,
      hasPlatformId: !!urlPlatform,
      hasAccessToken: !!urlAccessToken,
      hasCode: !!code,
      domain: urlDomain,
      platformInitiated
    });

    // Auto-generate channel name from domain
    const domainWithoutProtocol = decodeURIComponent(urlDomain).replace(/^https?:\/\//, '');
    const cleanName = domainWithoutProtocol.split('.')[0].replace(/[-_]/g, ' ');
    const capitalizedName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1) + ' Channel';
    setName(capitalizedName);
    setDomain(decodeURIComponent(urlDomain));
    
    // Handle platform-initiated flow (from OpenFront)
    if (platformInitiated === 'true' && urlPlatform) {
      console.log('🚀 Platform-initiated channel flow detected');
      setIsPlatformInitiated(true);
      setPlatformId(urlPlatform);
      setIsDialogOpen(true);

      // Clean URL params
      const newUrl = new URL(window.location.href);
      ['showCreateChannel', 'platform', 'domain', 'platformInitiated'].forEach(param => {
        newUrl.searchParams.delete(param);
      });
      router.replace(newUrl.pathname + newUrl.search);
      return;
    }
    
    // Check if this is marketplace flow (has client_id) or long flow (has platform)
    if (client_id && client_secret && app_name && adapter_slug && urlAccessToken) {
      // Marketplace flow - OAuth already exchanged, ready to create platform/channel
      console.log('✅ Marketplace flow detected for channels');
      setIsMarketplaceFlow(true);
      setClientId(client_id);
      setClientSecret(client_secret);
      setAppName(app_name);
      setAdapterSlug(adapter_slug);
      setAccessToken(urlAccessToken);
    } else if (urlPlatform && urlAccessToken) {
      // Long flow - platform exists, just need to create channel
      console.log('✅ Long flow detected for channels');
      setPlatformId(urlPlatform);
      setAccessToken(urlAccessToken);
      
      // Set additional token data if provided
      if (urlRefreshToken) setRefreshToken(urlRefreshToken);
      if (urlTokenExpiresAt) setTokenExpiresAt(urlTokenExpiresAt);
    } else {
      console.log('❌ Invalid OAuth callback - missing required parameters');
      return;
    }
    
    setIsDialogOpen(true);

    // Clean URL params
    const newUrl = new URL(window.location.href);
    ['showCreateChannel', 'showCreateChannelAndChannelAndPlatform', 'platform', 'accessToken', 'domain', 'client_id', 'client_secret', 'app_name', 'adapter_slug', 'refreshToken', 'tokenExpiresAt', 'code'].forEach(param => {
      newUrl.searchParams.delete(param);
    });
    router.replace(newUrl.pathname + newUrl.search);
  }, [searchParams, router]);

  const handleChannelCreation = async () => {
    if (!name.trim()) {
      toast.error('Please enter a channel name');
      return;
    }

    if (!domain.trim()) {
      toast.error('Please enter a channel domain');
      return;
    }

    setIsLoading(true);

    try {
      let finalPlatformId: string | null = platformId;

      // Marketplace flow: Check if platform exists
      if (isMarketplaceFlow && clientId && clientSecret) {
        console.log('🔍 Checking if channel platform exists for client_id:', clientId);
        
        const { getChannelPlatformByClientId } = await import('../actions/getChannelPlatformByClientId');
        const platformResult = await getChannelPlatformByClientId(clientId);
        
        console.log('🔍 Channel platform check result:', platformResult);
        
        if (platformResult.success && platformResult.data) {
          // Platform exists, use it
          finalPlatformId = platformResult.data.id;
          console.log('✅ Found existing channel platform ID:', finalPlatformId, 'Name:', platformResult.data.name);
        } else {
          // Platform doesn't exist, will create inline with channel
          console.log('📦 Channel platform does not exist, will create inline');
          finalPlatformId = null;
        }
      }

      // For marketplace flow, access token should come from OAuth callback
      let finalAccessToken = accessToken;
      if (!finalAccessToken && !isMarketplaceFlow && !isPlatformInitiated) {
        toast.error('Access token is required');
        return;
      }

      // Create the channel
      const channelData: any = {
        name: name.trim(),
        domain: domain.trim(),
        accessToken: finalAccessToken?.trim() || '',
        ...(refreshToken && { refreshToken: refreshToken }),
        ...(tokenExpiresAt && { tokenExpiresAt: new Date(tokenExpiresAt) }),
      };

      console.log('🏪 Creating channel with data:');
      console.log('  - finalPlatformId:', finalPlatformId);
      console.log('  - isMarketplaceFlow:', isMarketplaceFlow);
      console.log('  - isPlatformInitiated:', isPlatformInitiated);
      console.log('  - clientId:', clientId);
      console.log('  - adapterSlug:', adapterSlug);

      if (finalPlatformId) {
        console.log('🔗 Using existing channel platform ID:', finalPlatformId);
        channelData.platformId = finalPlatformId;
      } else if (isMarketplaceFlow && clientId && clientSecret && appName && adapterSlug) {
        // Create platform inline using dynamic adapter slug
        console.log('📦 Creating channel platform inline with adapter:', adapterSlug);
        channelData.platform = {
          create: {
            name: appName + ' (Auto-created)',
            appKey: clientId,
            appSecret: clientSecret,
            // Use adapter slug for all function mappings
            searchProductsFunction: adapterSlug,
            getProductFunction: adapterSlug,
            searchOrdersFunction: adapterSlug,
            updateProductFunction: adapterSlug,
            createWebhookFunction: adapterSlug,
            oAuthFunction: adapterSlug,
            oAuthCallbackFunction: adapterSlug,
            createOrderWebhookHandler: adapterSlug,
            cancelOrderWebhookHandler: adapterSlug,
            addTrackingFunction: adapterSlug,
            orderLinkFunction: adapterSlug,
            addCartToPlatformOrderFunction: adapterSlug,
            getWebhooksFunction: adapterSlug,
            deleteWebhookFunction: adapterSlug,
          }
        };
        console.log('📦 Channel platform inline creation data:', channelData.platform.create);
      } else if (!isPlatformInitiated) {
        console.log('❌ No platform connection - this will cause an error');
        console.log('❌ Missing: finalPlatformId?', !finalPlatformId, 'isMarketplaceFlow?', !isMarketplaceFlow, 'clientId?', !clientId, 'adapterSlug?', !adapterSlug);
      }

      console.log('🏪 Final channelData before createChannel call:', JSON.stringify(channelData, null, 2));

      const channelResult = await createChannel(channelData);

      if (channelResult.success) {
        toast.success('Channel connected successfully!');
        setIsDialogOpen(false);
        router.refresh();
        
        if (onChannelCreated) {
          onChannelCreated();
        }
      } else {
        toast.error(channelResult.error || 'Failed to create channel');
      }
    } catch (error) {
      console.error('Error creating channel:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create channel');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setIsDialogOpen(false);
    // Reset form
    setName('');
    setDomain('');
    setAccessToken('');
    setPlatformId('');
    setIsMarketplaceFlow(false);
    setIsPlatformInitiated(false);
    setClientId('');
    setClientSecret('');
    setAppName('');
    setAdapterSlug('');
    setRefreshToken('');
    setTokenExpiresAt('');
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect OpenFront Channel</DialogTitle>
          <DialogDescription>
            {isMarketplaceFlow
              ? 'Setting up your OpenFront integration. We\'ll create the platform if needed and connect your channel.'
              : isPlatformInitiated
              ? 'Connect your channel using the platform setup from OpenFront.'
              : 'Complete your channel setup with the OAuth credentials received.'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Channel Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter channel name"
              disabled={isLoading}
            />
          </div>

          <div>
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="channel.example.com"
              disabled={isLoading}
            />
          </div>

          {!isMarketplaceFlow && !isPlatformInitiated && (
            <div>
              <Label htmlFor="accessToken">Access Token</Label>
              <Input
                id="accessToken"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Access token from OAuth"
                disabled={isLoading}
                type="password"
              />
            </div>
          )}

          {isMarketplaceFlow && (
            <div className="text-sm bg-zinc-50 dark:bg-zinc-950/20 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
              <p className="font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                OpenFront Integration
              </p>
              <p className="text-zinc-700 dark:text-zinc-300 text-xs">
                This platform will be created with the channel.
              </p>
            </div>
          )}

          {isPlatformInitiated && (
            <div className="text-sm bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                Platform Integration
              </p>
              <p className="text-blue-700 dark:text-blue-300 text-xs">
                Using existing platform for this channel connection.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleChannelCreation}
            disabled={isLoading}
          >
            {isLoading 
              ? 'Connecting...' 
              : 'Connect Channel'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}