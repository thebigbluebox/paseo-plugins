import type { PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { shades } from "./colors";
import { Popover } from "./popover";

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

export function OptionRow({
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

export function Heading({ children, colors }: { children: string; colors: Colors }) {
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
 * The tree's filter: a small button that sits on the right of the first project's header and
 * opens a popover (a sheet on phones) of hosts and projects to tick. Nothing ticked in a list
 * means all of it. The host list shows only with several hosts.
 */
export function FilterButton({
  value,
  onChange,
  hosts,
  projects,
  compact,
  colors,
}: {
  value: TreeFilterValue;
  onChange(next: TreeFilterValue): void;
  hosts: FilterOption[];
  /** Projects on the hosts shown, so the list follows the host choice. */
  projects: FilterOption[];
  compact: boolean;
  colors: Colors;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const shade = shades(colors.foreground);
  const ticked = value.hosts.length + value.projects.length;
  const tint = ticked ? colors.accent : colors.foregroundMuted;

  return (
    <>
      <Pressable
        ref={anchor}
        accessibilityRole="button"
        accessibilityLabel={ticked ? `Filter, ${ticked} selected` : "Filter by host or project"}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          height: 20,
          paddingHorizontal: 5,
          borderRadius: 5,
          backgroundColor: pressed || open ? shade.pressed : hovered ? shade.hover : "transparent",
        })}
      >
        <Icon name="ListFilter" size={13} color={tint} />
        {ticked ? <Text style={{ color: tint, fontSize: 11, fontWeight: "600" }}>{ticked}</Text> : null}
      </Pressable>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        title="Filter"
        compact={compact}
        colors={colors}
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
        {ticked ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange({ hosts: [], projects: [] })}
            style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 }}
          >
            <Text style={{ color: colors.accent, fontSize: 12 }}>Clear filter</Text>
          </Pressable>
        ) : null}
      </Popover>
    </>
  );
}
