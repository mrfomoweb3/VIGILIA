// Pseudonymous end-user ids for Otari's per-user budgets.
//
// Otari bills and caps each end user named in a request's `user` field
// separately. Vigilia names the caller with a salted hash, never a raw IP, so
// the gateway's usage records hold no personal data.

import { createHash } from "node:crypto";

export type Channel = "demo" | "paid" | "a2a";

function salt(): string {
  return (process.env.END_USER_SALT ?? "vigilia").trim();
}

export function endUserId(channel: Channel, identity: string): string {
  const digest = createHash("sha256").update(`${salt()}:${identity}`).digest("hex").slice(0, 20);
  return `${channel}:${digest}`;
}

export function channelForPath(path: string): Channel {
  if (path.startsWith("/api/demo")) return "demo";
  if (path.startsWith("/api/internal")) return "a2a";
  return "paid";
}
