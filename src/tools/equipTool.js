/**
 * equipTool — equip an item from the bot's inventory.
 *
 * Destinations: "hand" (mainhand), "off-hand", "head", "torso", "legs", "feet"
 */

export const equipTool = {
  schema: {
    name: "equip_item",
    description:
      "Equip an item from the bot's inventory. " +
      "Destination can be 'hand' (main hand), 'off-hand', 'head', 'torso', 'legs', or 'feet'.",
    inputSchema: {
      type: "object",
      properties: {
        itemName: {
          type: "string",
          description: "Item to equip, e.g. 'diamond_shovel', 'iron_helmet'",
        },
        destination: {
          type: "string",
          enum: ["hand", "off-hand", "head", "torso", "legs", "feet"],
          description: "Where to equip the item. Default 'hand'.",
          default: "hand",
        },
      },
      required: ["itemName"],
    },
  },

  async execute(bot, { itemName, destination = "hand" }) {
    const itemId = bot.registry.itemsByName[itemName]?.id;
    if (!itemId) return { success: false, error: `Unknown item: "${itemName}"` };

    const item = bot.inventory.findInventoryItem(itemId, null, false);
    if (!item) return { success: false, error: `"${itemName}" not found in inventory` };

    await bot.equip(item, destination);

    return {
      success: true,
      equipped: itemName,
      destination,
      slot: item.slot,
    };
  },
};
