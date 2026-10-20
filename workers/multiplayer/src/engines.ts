import { V4Engine, type Dict } from "./v4.ts";
export const TEMPLATE_IDS = [
  "token-catch",
  "combat-duel",
  "boss-raid",
] as const;
export type RealtimeTemplate = (typeof TEMPLATE_IDS)[number];
export type Bootstrap = {
  roomId: string;
  roundId: string;
  configHash: string;
  seed: string;
  snapshot?: Dict;
  characters?: string[];
  commitHash?: string;
  owner?: string;
  settings?: Dict;
  participants: string[];
  config: {
    template_id: RealtimeTemplate;
    rules: { world_version: 4; [key: string]: unknown };
    [key: string]: unknown;
  };
};
export interface RoomEngine {
  step(dtMs: number): void;
  act(
    who: string,
    input: Record<string, unknown>,
  ): { accepted: boolean; error?: string };
  publicState(): Record<string, unknown>;
  checkpoint(): Record<string, unknown>;
  finished: boolean;
  ranking(): string[];
  eligible(): string[];
}
export const adapters = Object.fromEntries(
  TEMPLATE_IDS.map((template) => [
    template,
    {
      ready: true,
      create: (b: Bootstrap) => {
        if (!b.snapshot) throw new Error("INITIAL_SNAPSHOT_REQUIRED");
        const engine = new V4Engine(
          template,
          b.config.rules,
          b.seed,
          b.snapshot,
        );
        engine.characters = b.characters ?? [];
        return engine;
      },
    },
  ]),
) as Record<
  RealtimeTemplate,
  { ready: boolean; create: (b: Bootstrap) => V4Engine }
>;
export function validateBootstrap(raw: unknown, roomId: string): Bootstrap {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_BOOTSTRAP");
  const b = raw as Bootstrap;
  if (
    b.roomId !== roomId ||
    typeof b.roundId !== "string" ||
    !/^[0-9a-f]{16,64}$/.test(b.roundId) ||
    !/^0x[0-9a-f]{64}$/.test(b.configHash) ||
    !/^[0-9a-f]{64}$/.test(b.seed) ||
    !Array.isArray(b.participants) ||
    b.participants.length < 2 ||
    b.participants.length > 50 ||
    b.participants.some(
      (p) => typeof p !== "string" || !/^0x[0-9a-f]{40}$/.test(p),
    ) ||
    new Set(b.participants).size !== b.participants.length ||
    !b.config ||
    !TEMPLATE_IDS.includes(b.config.template_id) ||
    b.config.rules?.world_version !== 4
  )
    throw new Error("INVALID_BOOTSTRAP");
  if (b.config.template_id === "combat-duel" && b.participants.length !== 2)
    throw new Error("INVALID_BOOTSTRAP");
  return b;
}
