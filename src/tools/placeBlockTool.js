/**
 * placeBlockTool — place a block from inventory at a position near the bot.
 *
 * Used by the crafting workflow to place a crafting_table, furnace, etc.
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { Vec3 } from "vec3";
import { logger } from "../utils/logger.js";

export const placeBlockTool = {
  schema: {
    name: "place_block",
    description:
      "Place a block from the bot's inventory adjacent to the bot's current position. " +
      "Use this to place a crafting_table or furnace before crafting. " +
      "The bot will hold the block and place it on the ground nearby.",
    inputSchema: {
      type: "object",
      properties: {
        blockName: {
          type: "string",
          description: "Block item ID to place, e.g. 'crafting_table', 'furnace', 'torch'",
        },
      },
      required: ["blockName"],
    },
  },

  async execute(bot, { blockName }) {
    const itemId = bot.registry.itemsByName[blockName]?.id;
    if (itemId === undefined) {
      return { success: false, error: `Unknown block item: "${blockName}"` };
    }

    const item = bot.inventory.findInventoryItem(itemId, null, false);
    if (!item) {
      return { success: false, error: `"${blockName}" not found in inventory` };
    }

    // Find a solid block to place on (ground beneath bot)
    const faceVec = new Vec3(0, 1, 0); // place on top face
    const referenceBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));

    if (!referenceBlock || referenceBlock.name === "air") {
      return { success: false, error: "No solid block beneath bot to place on." };
    }

    await bot.equip(item, "hand");

    try {
      await bot.placeBlock(referenceBlock, faceVec);
      logger.info(`Placed ${blockName}`);

      // Short wait for world to register the block
      await new Promise((r) => setTimeout(r, 300));

      return { success: true, placed: blockName };
    } catch (err) {
      return { success: false, error: `Failed to place ${blockName}: ${err.message}` };
    }
  },
};
