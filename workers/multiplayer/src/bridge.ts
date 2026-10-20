import { hmac } from "./security.ts";
export async function bridgeHeaders(
  secret: string,
  path: string,
  body: string,
  now = Math.floor(Date.now() / 1000),
  nonce = crypto.randomUUID().replaceAll("-", ""),
) {
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    "Content-Type": "application/json",
    "X-Orbix-Time": String(now),
    "X-Orbix-Nonce": nonce,
    "X-Orbix-Signature": await hmac(
      secret,
      `orbix/result/v1\n${path}\n${now}\n${nonce}\n${digest}`,
    ),
  };
}
