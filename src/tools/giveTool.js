/**
 * giveTool — rzuca przedmioty na ziemię przed graczem.
 * Szuka gracza przez bot.entities AND bot.players dla maksymalnej odporności.
 */

import * as pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { logger } from "../utils/logger.js";

export const giveTool = {
  schema: {
    name: "give_item",
    description:
      "Give (toss) items to a player by walking close and dropping them on the ground. " +
      "Use when player asks for an item. playerName is optional — defaults to nearest player.",
    inputSchema: {
      type: "object",
      properties: {
        itemName: { type: "string", description: "Exact item ID, e.g. 'stick', 'oak_log'" },
        count: { type: "integer", description: "How many to give. Default 1.", default: 1 },
        playerName: { type: "string", description: "Username of target player (optional)" },
      },
      required: ["itemName"],
    },
  },

  async execute(bot, { itemName, count = 1, playerName }) {
    itemName = String(itemName).replace(/\s+/g, "_").toLowerCase();
    count = parseInt(count, 10) || 1;

    const targetEntity = _findPlayerEntity(bot, playerName);
    if (!targetEntity) {
      const known = Object.keys(bot.players).filter(p => p !== bot.username);
      return {
        success: false,
        error: `Cannot find player "${playerName ?? "nearest"}". Visible players: ${known.join(", ") || "none"}.`,
      };
    }

    const itemId = bot.registry.itemsByName[itemName]?.id;
    if (itemId === undefined) return { success: false, error: `Unknown item: "${itemName}"` };

    const inInventory = bot.inventory.items()
      .filter(i => i.type === itemId)
      .reduce((s, i) => s + i.count, 0);

    if (inInventory === 0) return { success: false, error: `No "${itemName}" in inventory.` };

    const actualCount = Math.min(count, inInventory);
    const pos = targetEntity.position;
    await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

    try {
      await bot.toss(itemId, null, actualCount);
      logger.info(`Gave ${actualCount}× ${itemName}`);
      return { success: true, gave: actualCount, itemName };
    } catch (err) {
      return { success: false, error: `Toss failed: ${err.message}` };
    }
  },
};

export function _findPlayerEntity(bot, playerName) {
  // 1. Search live entities in the world (most reliable)
  const fromEntities = Object.values(bot.entities).filter(
    e => e.type === "player" && e.username !== bot.username
  );

  // 2. Also build from bot.players (tab-list) if they have an entity attached
  const fromPlayers = Object.values(bot.players)
    .filter(p => p.username !== bot.username && p.entity)
    .map(p => p.entity);

  // Merge, deduplicate by entity id
  const seen = new Set();
  const all = [];
  for (const e of [...fromEntities, ...fromPlayers]) {
    if (!seen.has(e.id)) { seen.add(e.id); all.push(e); }
  }

  if (all.length === 0) return null;

  if (playerName) {
    return all.find(e => e.username?.toLowerCase() === playerName.toLowerCase()) ?? null;
  }

  return all.sort(
    (a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)
  )[0];
}
