Triage collects every agent that needs you into one deck of cards, so you can work through them without hunting through the sidebar. Open it from the Triage row at the top of the sidebar, which shows how many agents are waiting ("Triage · 3"), or from the Command Center with "Open triage".

An agent joins the deck when Paseo flags it for attention (it asked for a permission, it hit an error, or it finished a turn you have not read yet) or when it is stopped mid-turn on a question or permission request, which Paseo shows as a yellow workspace. Cards are dealt most urgent first (permissions, then errors, then finished agents), oldest first within each group. Background helper agents are left out. An agent that finished while work is still going on under it, such as agents it spawned still running or background tasks it left running, is held back as a progress report and comes back once that work is done; the header counts these as "reported in, still working". Permission requests and errors are never held. The deck covers every connected host.

Agents that belong together share a card. When an agent and agents it spawned (at any depth) all need attention, they are dealt as one family card instead of separate cards. The card opens with a small tree of the family's waiting agents, the top one selected, since it usually has the overview. Press a row to switch to that agent. An agent that skips a generation shows "via" the agent in between. A member leaves the tree once you handle it, and Skip moves the whole family to the back of the deck. An agent on its own gets a plain card with no tree.

Each card shows the workspace it belongs to, with the workspace it was spawned from in front of it (press the parent to open it), the agent's title, the task it was first given (press it to expand), and the agent's full last message. The card fills the window on every device, so the screen never scrolls; only the message inside the card does, opening at the end, where the agent usually asks you something. A permission card shows the command, file, or plan it wants approval for instead, and an error card shows the error. Inside the card you answer the agent: reply to it, or allow or deny a permission. On phones the screen slides up to keep the reply box above the keyboard, and swiping the message down puts the keyboard away. When an agent asks you a question, the card shows its options so you can pick one (or write your own when the question allows it) and answer without leaving the deck.

Below the card, two buttons move through the deck:

- Skip sends the card to the back of the deck. Skips last until the app restarts or the agent stops needing attention. It is greyed out when only one card is left.
- Open opens the selected agent in its workspace, which also marks it as read.

On desktop and web, single-key shortcuts work while the reply box is not focused: right arrow or S skips, O opens, up and down arrows (or K and J) move through a family's agents, R focuses the reply box, Y allows, and N denies. Enter in the reply box sends and Shift+Enter adds a line.

Parent workspaces come from what Paseo recorded when the workspace was created. Moving a workspace in the Workspace tree plugin does not change it here.

Plugins cannot clear Paseo's attention flag, so skipping does not mark an agent as read. The sidebar keeps showing it as unread until you open it, reply, or answer its permission request.
