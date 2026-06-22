import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { Activity, Layers } from "lucide-react";
import clsx from "clsx";
import { AiActivityEventsTab } from "./ai-activity/AiActivityEventsTab";
import { AiActivitySessionsTab } from "./ai-activity/AiActivitySessionsTab";

type AiActivityTab = "events" | "sessions";

const TABS: Array<{
  id: AiActivityTab;
  icon: React.ComponentType<{ size: number }>;
  label: MessageDescriptor;
}> = [
  { id: "events", icon: Activity, label: msg`Events` },
  { id: "sessions", icon: Layers, label: msg`Sessions` },
];

export function AiActivityPanel() {
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState<AiActivityTab>("events");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-primary">
          {t`AI Activity`}
        </h2>
        <p className="text-xs text-muted mt-1">
          {t`Audit log of every MCP tool call, plus the queries waiting for your approval. Stored locally — never sent anywhere.`}
        </p>
      </div>

      <div className="flex gap-1 border-b border-default">
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === id
                ? "text-primary border-blue-500"
                : "text-muted border-transparent hover:text-primary",
            )}
          >
            <Icon size={14} />
            {i18n._(label)}
          </button>
        ))}
      </div>

      {tab === "events" ? <AiActivityEventsTab /> : <AiActivitySessionsTab />}
    </div>
  );
}
