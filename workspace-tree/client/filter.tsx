import type { PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { shades } from "./colors";

type Colors = PluginSidebarViewProps["theme"]["colors"];

export interface TreeFilterValue {
  hosts: string[];
  projects: string[];
}

export interface FilterOption {
  key: string;
  label: string;
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}

function OptionRow({
  option,
  checked,
  onPress,
  colors,
}: {
  option: FilterOption;
  checked: boolean;
  onPress(): void;
  colors: Colors;
}) {
  const shade = shades(colors.foreground);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={option.label}
      onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: pressed ? shade.pressed : hovered ? shade.hover : "transparent",
      })}
    >
      <View style={{ width: 14, alignItems: "center" }}>
        {checked ? <Icon name="Check" size={13} color={colors.accent} /> : null}
      </View>
      <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }} numberOfLines={1}>
        {option.label}
      </Text>
    </Pressable>
  );
}

function Heading({ children, colors }: { children: string; colors: Colors }) {
  return (
    <Text
      style={{
        color: colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600",
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: 2,
      }}
    >
      {children}
    </Text>
  );
}

/**
 * The tree's filter: a button at the top that opens a panel of hosts and projects to tick.
 * Nothing ticked in a list means all of it. The host list shows only with several hosts.
 */
export function FilterBar({
  value,
  onChange,
  hosts,
  projects,
  colors,
}: {
  value: TreeFilterValue;
  onChange(next: TreeFilterValue): void;
  hosts: FilterOption[];
  /** Projects on the hosts shown, so the list follows the host choice. */
  projects: FilterOption[];
  colors: Colors;
}) {
  const [open, setOpen] = useState(false);
  const shade = shades(colors.foreground);
  const hostNames = hosts.filter((host) => value.hosts.includes(host.key)).map((host) => host.label);
  const projectNames = projects.filter((project) => value.projects.includes(project.key)).map((project) => project.label);
  const active = value.hosts.length > 0 || value.projects.length > 0;
  const summary = [...hostNames, ...projectNames].join(", ");

  return (
    <View style={{ paddingHorizontal: 6, paddingBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 24 }}>
        <Text style={{ color: colors.foregroundMuted, fontSize: 11, flex: 1, paddingLeft: 4 }} numberOfLines={1}>
          {active ? summary || "Filtered" : ""}
        </Text>
        {active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear filter"
            onPress={() => onChange({ hosts: [], projects: [] })}
            hitSlop={6}
          >
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Clear</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "Close filter" : "Filter by host or project"}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((value) => !value)}
          hitSlop={6}
          style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            height: 22,
            paddingHorizontal: 6,
            borderRadius: 5,
            backgroundColor: pressed || open ? shade.pressed : hovered ? shade.hover : "transparent",
          })}
        >
          <Icon name="ListFilter" size={13} color={active ? colors.accent : colors.foregroundMuted} />
          <Text style={{ color: active ? colors.accent : colors.foregroundMuted, fontSize: 11, fontWeight: "500" }}>
            Filter
          </Text>
        </Pressable>
      </View>

      {open ? (
        <View
          style={{
            marginTop: 2,
            marginBottom: 4,
            paddingVertical: 4,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: shade.line,
          }}
        >
          {hosts.length > 1 ? (
            <>
              <Heading colors={colors}>Hosts</Heading>
              {hosts.map((host) => (
                <OptionRow
                  key={host.key}
                  option={host}
                  checked={value.hosts.includes(host.key)}
                  onPress={() => onChange({ ...value, hosts: toggle(value.hosts, host.key) })}
                  colors={colors}
                />
              ))}
            </>
          ) : null}
          <Heading colors={colors}>Projects</Heading>
          {projects.length === 0 ? (
            <Text style={{ color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
              No projects
            </Text>
          ) : (
            projects.map((project) => (
              <OptionRow
                key={project.key}
                option={project}
                checked={value.projects.includes(project.key)}
                onPress={() => onChange({ ...value, projects: toggle(value.projects, project.key) })}
                colors={colors}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}
