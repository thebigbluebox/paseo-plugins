import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ReviewItemSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  draft: z.boolean(),
  updatedAt: z.string(),
  /** review: your review is requested. reapprove: your approval no longer counts. */
  kind: z.enum(["review", "reapprove"]),
  /** The latest commit's combined CI state, as on workspace PR chips. */
  checks: z.enum(["success", "pending", "failure", "none"]).default("none"),
  conflicting: z.boolean().default(false),
  review: z.enum(["approved", "changes_requested", "pending"]).nullable().default(null),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

/** Open pull requests waiting for the gh user's review or re-approval, newest first. */
export const pendingReviews = defineRpc({
  name: "reviews.pending",
  input: z.object({ force: z.boolean().optional() }),
  output: z.object({
    items: z.array(ReviewItemSchema),
    fetchedAt: z.string(),
    error: z.string().nullable(),
  }),
});
