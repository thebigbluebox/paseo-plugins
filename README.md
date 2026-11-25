# Paseo plugins

Local Paseo plugins, one per folder. Each folder has its own `paseo-plugin.json`, `OVERVIEW.md` and `package.json`.

| Plugin | What it does |
| --- | --- |
| [workspace-labels](workspace-labels) | Gives agents tools to add and remove workspace labels |
| [workspace-tree](workspace-tree) | Sidebar view that nests workspaces under the workspace that spawned them, with drag to move and every PR per workspace |
| [gruvbox-material](gruvbox-material) | Gruvbox Material dark and light themes, in hard, medium and soft contrast |
| [triage](triage) | A deck of cards for every agent that needs attention: reply, allow or deny, skip, archive, or open |

## Develop

```bash
cd <plugin>
npm install
npm run typecheck
paseo plugin install "$PWD"      # first time
paseo plugin reload <plugin-id>  # after edits
```

Plugin IDs (`paseo-workspace-labels`, `paseo-workspace-tree`, `paseo-gruvbox-material`, `paseo-triage`) are set in each `paseo-plugin.json`. Paseo stores plugin settings by ID, so keep IDs stable when moving folders.
