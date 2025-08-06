import React, { useState } from "react";
import { EllipsisVertical, Plus, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { CreatePlatform } from "./CreatePlatform";
import { CreateChannel } from "./CreateChannel";

interface PlatformCardProps {
  platforms: any[];
  openDrawer: (id: string, listKey: string) => void;
  setSelectedPlatform: (id: string | null) => void;
}

export const PlatformCard: React.FC<PlatformCardProps> = ({ platforms, openDrawer, setSelectedPlatform }) => {
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const router = useRouter();

  const handlePlatformClick = (platformId: string) => {
    if (selectedPlatformId === platformId) {
      setSelectedPlatformId(null);
      setSelectedPlatform(null);
    } else {
      setSelectedPlatformId(platformId);
      setSelectedPlatform(platformId);
    }
  };

  const handleChannelCreated = () => {
    // Refresh the page to show the new channel
    router.refresh();
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-xs font-normal mb-3 text-muted-foreground">
          Platforms
        </h2>
        <div className="flex flex-wrap gap-2">
          <CreatePlatform
            trigger={
              platforms.length === 0 ? (
                <Button
                  variant="secondary"
                  className="border rounded-lg h-8 px-3 flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create platform to get started</span>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  className="border rounded-lg h-8 w-8"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )
            }
          />
          {platforms.map((platform: any) => (
            <Badge
              key={platform.id}
              className={`cursor-pointer flex items-center justify-between gap-2 uppercase tracking-wide border pl-3 text-xs font-medium rounded-[calc(theme(borderRadius.lg)-1px)] ${
                selectedPlatformId === platform.id ? "opacity-100 bg-sky-100 text-sky-900 border-sky-200" : "opacity-70"
              }`}
              onClick={() => handlePlatformClick(platform.id)}
            >
              {platform.name}

              <Button
                variant="secondary"
                size="icon"
                className="border [&_svg]:size-2.5 h-5 w-5"
                onClick={(e) => {
                  e.stopPropagation();
                  openDrawer(platform.id, "ChannelPlatform");
                }}
              >
                <EllipsisVertical />
              </Button>
            </Badge>
          ))}
        </div>
      </div>

      {/* Create Channel Section */}
      {platforms.length > 0 && (
        <div>
          <h2 className="text-xs font-normal mb-3 text-muted-foreground">
            Actions
          </h2>
          <div className="flex flex-wrap gap-2">
            <CreateChannel />
          </div>
        </div>
      )}
    </div>
  );
};