/**
 * inventoryTool — read and manipulate the bot's inventory.
 */

export const inventoryTool = {
  schema: {
    name: "inventory_action",
    description:
      "Inspect or manage the bot's inventory. " +
      "Actions: list (show all items), find (search for a specific item), " +
      "drop (drop an item onto the ground), toss_all (drop all of a type).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "find", "drop", "toss_all"],
          description: "What to do",
        },
        itemName: {
          type: "string",
          description: "Item name for find/drop/toss_all, e.g. 'diamond_shovel'",
        },
        count: {
          type: "integer",
          description: "How many to drop (for 'drop' action). Default 1.",
          default: 1,
        },
      },
      required: ["action"],
    },
  },

  async execute(bot, { action, itemName, count = 1 }) {
    switch (action) {
      case "list": {
        const items = bot.inventory.items().map((i) => ({
          name: i.name,
          count: i.count,
          slot: i.slot,
        }));
        return { success: true, items };
      }

      case "find": {
        if (!itemName) return { success: false, error: "itemName is required for find" };
        const items = bot.inventory.items().filter((i) => i.name === itemName);
        return {
          success: items.length > 0,
          found: items.length > 0,
          totalCount: items.reduce((s, i) => s + i.count, 0),
          slots: items.map((i) => ({ slot: i.slot, count: i.count })),
        };
      }

      case "drop": {
        if (!itemName) return { success: false, error: "itemName is required for drop" };
        const item = bot.inventory.findInventoryItem(
          bot.registry.itemsByName[itemName]?.id,
          null,
          false
        );
        if (!item) return { success: false, error: `"${itemName}" not in inventory` };
        await bot.toss(item.type, null, Math.min(count, item.count));
        return { success: true, dropped: Math.min(count, item.count), itemName };
      }

      case "toss_all": {
        if (!itemName) return { success: false, error: "itemName is required for toss_all" };
        const itemId = bot.registry.itemsByName[itemName]?.id;
        if (!itemId) return { success: false, error: `Unknown item: "${itemName}"` };
        await bot.tossStack(bot.inventory.findInventoryItem(itemId, null, false));
        return { success: true, action: "toss_all", itemName };
      }

      default:
        return { success: false, error: `Unknown inventory action: "${action}"` };
    }
  },
};
