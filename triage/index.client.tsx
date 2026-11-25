import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useTriageCount } from "./client/queue";
import { TriageScreen } from "./client/screen";

const SCREEN = "deck";

function TriageItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const count = useTriageCount();
  return (
    <SidebarRow
      icon="Layers"
      label={count > 0 ? `Triage · ${count}` : "Triage"}
      active={currentScreen?.screenId === SCREEN}
      onPress={() => openScreen({ screenId: SCREEN })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN, title: "Triage", Component: TriageScreen }),
    client.addSidebarHeaderItem({ id: SCREEN, title: "Triage", Component: TriageItem }),
    client.addCommandCenterItem({
      id: "open-triage",
      title: "Open triage",
      icon: "Layers",
      keywords: ["attention", "inbox", "agents", "permission", "unread"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN });
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
