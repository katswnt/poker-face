// Public preflop betting tree for a PreflopSpotV1 (spec §2), with pot and stack closure checks.
//
// Node ids are action paths from the root: "" (root), "r2.5", "r2.5/r11", "r2.5/jam", …
// Action labels: "fold", "call", "r<to>" (raise to <to> bb), "jam" (all-in for the stack).
import type { PotType, PreflopPlayer, PreflopSpotV1 } from "./contract";

export type PreflopTerminalKind = "fold" | "showdown" | "flop";

export interface PreflopDecisionNode {
  readonly kind: "decision";
  readonly id: string;
  readonly player: PreflopPlayer;
  /** Total chips each player has put in this hand before the decision. */
  readonly contrib: readonly [number, number];
  readonly raiseLevel: number;
  readonly actions: readonly string[];
  readonly children: readonly PreflopNode[];
}

export interface PreflopTerminalNode {
  readonly kind: "terminal";
  readonly id: string;
  readonly terminal: PreflopTerminalKind;
  readonly contrib: readonly [number, number];
  /** fold: the player who folded. */
  readonly folder?: PreflopPlayer;
  /** flop: the pot type that R is looked up with. */
  readonly potType?: PotType;
  /** Total pot at the terminal (both contributions + dead money), before rake. */
  readonly pot: number;
}

export type PreflopNode = PreflopDecisionNode | PreflopTerminalNode;

export interface PreflopTree {
  readonly root: PreflopDecisionNode;
  readonly decisions: readonly PreflopDecisionNode[];
  readonly terminals: readonly PreflopTerminalNode[];
  readonly byId: ReadonlyMap<string, PreflopNode>;
}

const POT_BY_LEVEL: Record<number, PotType> = { 1: "srp", 2: "3bp", 3: "4bp" };
const EPS = 1e-9;

function childId(parent: string, action: string): string {
  return parent === "" ? action : `${parent}/${action}`;
}

export function buildPreflopTree(spot: PreflopSpotV1): PreflopTree {
  const { structure, menu } = spot;
  const stack = structure.stack, dead = structure.dead;
  const decisions: PreflopDecisionNode[] = [];
  const terminals: PreflopTerminalNode[] = [];
  const byId = new Map<string, PreflopNode>();

  const terminal = (id: string, kind: PreflopTerminalKind, contrib: [number, number], extra: { folder?: PreflopPlayer; potType?: PotType }) => {
    for (const c of contrib) if (c < -EPS || c > stack + EPS) throw new Error(`tree ${id}: contribution ${c} outside [0, ${stack}]`);
    if (kind !== "fold" && Math.abs(contrib[0] - contrib[1]) > EPS) throw new Error(`tree ${id}: ${kind} with unequal contributions ${contrib}`);
    if (kind === "showdown" && Math.abs(contrib[0] - stack) > EPS) throw new Error(`tree ${id}: showdown before both are all-in`);
    if (kind === "fold" && extra.folder !== undefined && contrib[extra.folder] > contrib[1 - extra.folder] + EPS) {
      throw new Error(`tree ${id}: folder had already matched the bet`);
    }
    const node: PreflopTerminalNode = { kind: "terminal", id, terminal: kind, contrib, pot: contrib[0] + contrib[1] + dead, ...extra };
    terminals.push(node);
    byId.set(id, node);
    return node;
  };

  const decision = (id: string, player: PreflopPlayer, contrib: [number, number], raiseLevel: number, isRoot: boolean): PreflopDecisionNode => {
    const opponent = (1 - player) as PreflopPlayer;
    const facing = contrib[opponent], own = contrib[player];
    if (!(facing > own)) throw new Error(`tree ${id}: player ${player} is not facing a bet (limp trees are not in v1)`);
    const actions: string[] = [];
    const children: PreflopNode[] = [];
    const add = (action: string, node: PreflopNode) => { actions.push(action); children.push(node); };

    add("fold", terminal(childId(id, "fold"), "fold", [...contrib] as [number, number], { folder: player }));

    const facingJam = Math.abs(facing - stack) < EPS;
    if (!isRoot) {
      const called: [number, number] = [facing, facing];
      if (facingJam) add("call", terminal(childId(id, "call"), "showdown", called, {}));
      else {
        const potType = POT_BY_LEVEL[raiseLevel];
        if (!potType) throw new Error(`tree ${id}: no pot type for raise level ${raiseLevel}`);
        add("call", terminal(childId(id, "call"), "flop", called, { potType }));
      }
    }
    if (!facingJam) {
      if (raiseLevel < menu.raises.length) {
        const to = menu.raises[raiseLevel];
        if (!(to > facing + EPS) || !(to < stack - EPS)) throw new Error(`tree ${id}: raise to ${to} not in (${facing}, ${stack})`);
        const next: [number, number] = [...contrib] as [number, number];
        next[player] = to;
        const label = `r${to}`;
        add(label, decision(childId(id, label), opponent, next, raiseLevel + 1, false));
      }
      const jamAllowed = isRoot ? menu.openJam : menu.jamOverRaise;
      if (jamAllowed) {
        const next: [number, number] = [...contrib] as [number, number];
        next[player] = stack;
        add("jam", decision(childId(id, "jam"), opponent, next, raiseLevel + 1, false));
      }
    }
    if (actions.length < 2) throw new Error(`tree ${id}: fewer than two actions`);
    const node: PreflopDecisionNode = { kind: "decision", id, player, contrib, raiseLevel, actions, children };
    decisions.push(node);
    byId.set(id, node);
    return node;
  };

  const root = decision("", 0, [structure.posted[0], structure.posted[1]], 0, true);
  // Closure: every terminal pot = contributions + dead, and no chips are created.
  for (const t of terminals) {
    if (Math.abs(t.pot - (t.contrib[0] + t.contrib[1] + dead)) > EPS) throw new Error(`tree ${t.id}: pot does not close`);
  }
  decisions.sort((a, b) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { root, decisions, terminals, byId };
}

/** A strategy profile: per decision-node id, freq[actionIndex][classPosition]. */
export type PreflopProfile = ReadonlyMap<string, readonly (readonly number[])[]>;
