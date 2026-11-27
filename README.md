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

## Branches

This repo is a fork of [ocnc/paseo-plugins](https://github.com/ocnc/paseo-plugins).

- `main` mirrors `upstream/main`. Don't commit to it directly.
- `dev` is where our own plugins and changes live. The local daemon runs plugins from a `dev` checkout.

Pull upstream changes into both:

```bash
git fetch upstream
git switch main && git merge --ff-only upstream/main && git push origin main
git switch dev && git merge main && git push origin dev
paseo plugin reload <plugin-id>
```

New plugins go in their own folder: `paseo plugin init "$PWD/<name>"`, then add a row to the table above.
