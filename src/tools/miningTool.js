/**
 * miningTool — find and mine blocks.
 *
 * Supports "any_log" alias that searches ALL log types simultaneously.
 * Waits for pickup before returning.
 * Never digs straight down.
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { logger } from "../utils/logger.js";

// "any_log" → search all these block types at once
const ALL_LOG_TYPES = [
  "oak_log","birch_log","spruce_log","jungle_log",
  "acacia_log","dark_oak_log","mangrove_log","cherry_log",
];

// Deepslate variants for ores
const BLOCK_EXPAND = {
  coal_ore:    ["coal_ore","deepslate_coal_ore"],
  iron_ore:    ["iron_ore","deepslate_iron_ore"],
  gold_ore:    ["gold_ore","deepslate_gold_ore"],
  diamond_ore: ["diamond_ore","deepslate_diamond_ore"],
  emerald_ore: ["emerald_ore","deepslate_emerald_ore"],
  stone:       ["stone","cobblestone"],
};

// What item a block drops
const BLOCK_DROP = {
  stone:"cobblestone", cobblestone:"cobblestone",
  coal_ore:"coal", deepslate_coal_ore:"coal",
  iron_ore:"raw_iron", deepslate_iron_ore:"raw_iron",
  gold_ore:"raw_gold", deepslate_gold_ore:"raw_gold",
  diamond_ore:"diamond", deepslate_diamond_ore:"diamond",
  emerald_ore:"emerald", deepslate_emerald_ore:"emerald",
};
// logs just drop themselves
ALL_LOG_TYPES.forEach(l => BLOCK_DROP[l] = l);

export const miningTool = {
  schema: {
    name: "mine_block",
    description: "Find and mine blocks. Use 'any_log' to mine any tree log type.",
    inputSchema: {
      type: "object",
      properties: {
        blockType: { type: "string", description: "Block ID or 'any_log'" },
        count:     { type: "integer", default: 1 },
        maxDistance: { type: "number", default: 64 },
      },
      required: ["blockType"],
    },
  },

  async execute(bot, { blockType, count = 1, maxDistance = 64 }) {
    count = Math.max(1, parseInt(count) || 1);
    blockType = String(blockType).toLowerCase().trim();

    // Resolve block IDs to search
    let blockNames;
    if (blockType === "any_log" || blockType === "log") {
      blockNames = ALL_LOG_TYPES;
    } else {
      blockNames = BLOCK_EXPAND[blockType] ?? [blockType];
    }

    const blockIds = blockNames
      .map(n => bot.registry.blocksByName[n]?.id)
      .filter(id => id !== undefined);

    if (blockIds.length === 0) {
      return { success: false, error: `Unknown block: "${blockType}"` };
    }

    let mined = 0;
    for (let i = 0; i < count; i++) {
      const block = bot.findBlock({ matching: blockIds, maxDistance });
      if (!block) {
        return {
          success: mined > 0,
          mined,
          error: `No "${blockType}" within ${maxDistance} blocks.`,
        };
      }

      try {
        await bot.pathfinder.goto(
          new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3)
        );
      } catch { /* moved, continue */ }

      const fresh = bot.blockAt(block.position);
      if (!fresh || fresh.name === "air") { i--; continue; }

      const dropName = BLOCK_DROP[fresh.name] ?? fresh.name;
      const before = _count(bot, dropName);

      try {
        if (bot.collectBlock) {
          await bot.collectBlock.collect(fresh);
        } else {
          await bot.dig(fresh);
          await _waitPickup(bot, dropName, before, 2500);
        }
        mined++;
        logger.info(`Mined ${fresh.name} (${mined}/${count})`);
      } catch (err) {
        logger.warn(`Dig error: ${err.message}`);
      }

      await _sleep(200);
    }

    return { success: mined > 0, mined, blockType };
  },
};

function _count(bot, name) {
  const id = bot.registry.itemsByName[name]?.id;
  if (!id) return 0;
  return bot.inventory.items().filter(i => i.type === id).reduce((s,i) => s+i.count, 0);
}

function _waitPickup(bot, name, before, ms) {
  return new Promise(resolve => {
    const end = Date.now() + ms;
    const t = setInterval(() => {
      if (_count(bot, name) > before || Date.now() > end) {
        clearInterval(t); resolve();
      }
    }, 100);
  });
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
