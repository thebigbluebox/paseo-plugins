import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listWorkspacePullRequests } from "./server/prs";
import { reviewSettings, treeParents } from "./shared/preferences";
import { workspacePullRequests } from "./shared/prs";
import { readPendingReviews } from "./server/reviews";
import { pendingReviews } from "./shared/reviews";

export default function contribute(server: PluginServerContext) {
  // Host-scoped settings are stored by the daemon; registering makes the document available.
  server.registerSettings(treeParents);
  server.registerSettings(reviewSettings);
  server.handle(workspacePullRequests, ({ refresh }, { paseo }) =>
    listWorkspacePullRequests(paseo, refresh),
  );
  server.handle(pendingReviews, ({ force }) => readPendingReviews(force ?? false));
  return () => {};
}
