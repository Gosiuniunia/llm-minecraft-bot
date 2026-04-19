/**
 * craftingTool — craft items.
 *
 * Key fixes:
 * - any_log / any *_planks accepted as ingredients
 * - tries ALL recipe variants
 * - better error messages showing actual inventory
 * - waits after craft for inventory to settle
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { Vec3 } from "vec3";
import { logger } from "../utils/logger.js";

// Items that NEVER need a crafting table
const NO_TABLE = new Set([
  "oak_planks","birch_planks","spruce_planks","jungle_planks",
  "acacia_planks","dark_oak_planks","mangrove_planks","cherry_planks",
  "bamboo_planks","crimson_planks","warped_planks",
  "stick","crafting_table","torch",
]);

const ALL_LOG_TYPES = [
  "oak_log","birch_log","spruce_log","jungle_log",
  "acacia_log","dark_oak_log","mangrove_log","cherry_log",
];

export const craftingTool = {
  schema: {
    name: "craft_item",
    description: "Craft an item. Planks/sticks/crafting_table need no table. Tools need a table.",
    inputSchema: {
      type: "object",
      properties: {
        itemName: { type: "string" },
        count:    { type: "integer", default: 1 },
      },
      required: ["itemName"],
    },
  },

  async execute(bot, { itemName, count = 1 }) {
    itemName = String(itemName).replace(/\s+/g,"_").toLowerCase();
    count = Math.max(1, parseInt(count) || 1);

    // "any_planks" → use whichever planks we have most of
    if (itemName === "any_planks" || itemName === "planks") {
      itemName = _bestPlanks(bot) ?? "oak_planks";
    }

    const itemId = bot.registry.itemsByName[itemName]?.id;
    if (itemId === undefined) {
      const close = Object.keys(bot.registry.itemsByName)
        .filter(n => n.includes(itemName)).slice(0,4);
      return { success:false, error:`Unknown item "${itemName}". Closest: ${close.join(", ")||"none"}` };
    }

    if (NO_TABLE.has(itemName)) {
      return _craftNoTable(bot, itemName, itemId, count);
    }
    return _craftWithTable(bot, itemName, itemId, count);
  },
};

// ── No-table crafting (planks, sticks, crafting_table) ───────────────────────

async function _craftNoTable(bot, itemName, itemId, count) {
  // Special case: planks from any log
  if (itemName.endsWith("_planks")) {
    return _craftPlanks(bot, itemName, itemId, count);
  }

  const recipes = bot.recipesAll(itemId, null, null);
  if (!recipes?.length) {
    return { success:false, error:`No recipe for "${itemName}".` };
  }

  for (const r of recipes) {
    try {
      await bot.craft(r, count, null);
      await _sleep(300);
      logger.info(`Crafted ${count}x ${itemName} (no table)`);
      return { success:true, crafted:count, itemName };
    } catch {}
  }

  const inv = _invStr(bot);
  return { success:false, error:`Craft failed for "${itemName}". Have: ${inv}` };
}

async function _craftPlanks(bot, itemName, itemId, count) {
  // Find any log in inventory
  const logItem = bot.inventory.items().find(i => ALL_LOG_TYPES.includes(i.name));
  if (!logItem) {
    return { success:false, error:`Need any log to craft planks but inventory has none.` };
  }

  // Get the matching planks item id for this log type
  const planksName = logItem.name.replace("_log","_planks");
  const planksId = bot.registry.itemsByName[planksName]?.id ?? itemId;

  const recipes = bot.recipesAll(planksId, null, null);
  if (!recipes?.length) {
    return { success:false, error:`No planks recipe found.` };
  }

  for (const r of recipes) {
    try {
      await bot.craft(r, count, null);
      await _sleep(300);
      logger.info(`Crafted ${count}x ${planksName} (no table)`);
      return { success:true, crafted:count, itemName: planksName };
    } catch {}
  }

  return { success:false, error:`Planks craft failed. Have: ${_invStr(bot)}` };
}

// ── Table crafting (tools etc.) ──────────────────────────────────────────────

async function _craftWithTable(bot, itemName, itemId, count) {
  // Find or place crafting table
  let table = _findTable(bot);

  if (!table) {
    const placed = await _placeTable(bot);
    if (!placed) {
      return { success:false, error:`Need crafting table but can't find or place one.` };
    }
    table = _findTable(bot);
    if (!table) return { success:false, error:`Placed table but couldn't locate it.` };
  }

  // Walk to table
  try {
    await bot.pathfinder.goto(
      new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2)
    );
  } catch {}

  // Re-find after walking
  table = _findTable(bot);
  if (!table) return { success:false, error:`Lost crafting table.` };

  const recipes = bot.recipesAll(itemId, null, table);
  if (!recipes?.length) {
    return { success:false, error:`No recipe for "${itemName}" at table. Have: ${_invStr(bot)}` };
  }

  for (const r of recipes) {
    try {
      await bot.craft(r, count, table);
      await _sleep(500);
      logger.info(`Crafted ${count}x ${itemName} (with table)`);
      return { success:true, crafted:count, itemName };
    } catch (e) {
      logger.warn(`Recipe variant failed: ${e.message}`);
    }
  }

  return { success:false, error:`All recipes failed for "${itemName}". Have: ${_invStr(bot)}` };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _findTable(bot) {
  return bot.findBlock({
    matching: bot.registry.blocksByName["crafting_table"]?.id,
    maxDistance: 32,
  });
}

async function _placeTable(bot) {
  const id = bot.registry.itemsByName["crafting_table"]?.id;
  const item = bot.inventory.findInventoryItem(id, null, false);
  if (!item) return false;

  const botPos = bot.entity.position.floored();

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const surface = bot.blockAt(botPos.offset(dx, -1, dz));
      if (!surface || surface.name === "air") continue;
      const above = bot.blockAt(surface.position.offset(0,1,0));
      if (above && above.name !== "air") continue;
      try {
        await bot.equip(item, "hand");
        await bot.placeBlock(surface, new Vec3(0,1,0));
        await _sleep(500);
        logger.info("Placed crafting_table");
        return true;
      } catch {}
    }
  }
  return false;
}

function _bestPlanks(bot) {
  const plankTypes = bot.inventory.items()
    .filter(i => i.name.endsWith("_planks"))
    .sort((a,b) => b.count - a.count);
  return plankTypes[0]?.name ?? null;
}

function _invStr(bot) {
  return bot.inventory.items().map(i=>`${i.name}x${i.count}`).join(", ") || "empty";
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
