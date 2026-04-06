/**
 * inspectTool — scan the environment for blocks and entities.
 *
 * Gives the LLM situational awareness: where is diamond ore? is there a
 * creeper nearby? what block am I standing on?
 */

export const inspectTool = {
  schema: {
    name: "inspect_surroundings",
    description:
      "Scan the area around the bot for blocks and/or entities. " +
      "Returns positions and distances so the LLM can plan the next move. " +
      "Use this before mining or attacking to confirm targets exist and locate them.",
    inputSchema: {
      type: "object",
      properties: {
        searchType: {
          type: "string",
          enum: ["blocks", "entities", "both"],
          description: "What to scan for. Default 'both'.",
          default: "both",
        },
        blockType: {
          type: "string",
          description: "Block ID to search for, e.g. 'diamond_ore'. Required when searchType includes 'blocks'.",
        },
        entityType: {
          type: "string",
          description: "Entity name filter, e.g. 'cow', 'zombie'. Leave blank for all entities.",
        },
        maxDistance: {
          type: "number",
          description: "Search radius in blocks. Default 32.",
          default: 32,
        },
        maxResults: {
          type: "integer",
          description: "Max results to return per category. Default 5.",
          default: 5,
        },
      },
      required: ["searchType"],
    },
  },

  async execute(bot, { searchType = "both", blockType, entityType, maxDistance = 32, maxResults = 5 }) {
    const result = {};

    // ── Block scan ───────────────────────────────────────────────
    if ((searchType === "blocks" || searchType === "both") && blockType) {
      const blockId = bot.registry.blocksByName[blockType]?.id;

      if (blockId === undefined) {
        result.blocks = { error: `Unknown block: "${blockType}"` };
      } else {
        const found = [];
        let block;
        let searchPos = bot.entity.position;

        // findBlock returns one at a time; iterate to get maxResults
        const seen = new Set();
        for (let i = 0; i < maxResults; i++) {
          block = bot.findBlock({
            matching: blockId,
            maxDistance,
            useExtraInfo: true,
          });
          if (!block) break;

          const key = block.position.toString();
          if (seen.has(key)) break;
          seen.add(key);

          found.push({
            position: {
              x: block.position.x,
              y: block.position.y,
              z: block.position.z,
            },
            distance: bot.entity.position.distanceTo(block.position).toFixed(1),
          });
        }

        result.blocks = { blockType, count: found.length, locations: found };
      }
    }

    // ── Entity scan ──────────────────────────────────────────────
    if (searchType === "entities" || searchType === "both") {
      const entities = Object.values(bot.entities)
        .filter((e) => {
          if (e === bot.entity) return false;
          if (e.position.distanceTo(bot.entity.position) > maxDistance) return false;
          if (entityType && e.name !== entityType) return false;
          return true;
        })
        .sort((a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
        )
        .slice(0, maxResults)
        .map((e) => ({
          id: e.id,
          name: e.name ?? e.username ?? "unknown",
          type: e.type,
          position: {
            x: e.position.x.toFixed(1),
            y: e.position.y.toFixed(1),
            z: e.position.z.toFixed(1),
          },
          distance: e.position.distanceTo(bot.entity.position).toFixed(1),
          health: e.health ?? null,
        }));

      result.entities = { count: entities.length, entities };
    }

    // ── Bot state snapshot ───────────────────────────────────────
    const pos = bot.entity.position;
    result.botPosition = {
      x: pos.x.toFixed(1),
      y: pos.y.toFixed(1),
      z: pos.z.toFixed(1),
    };

    return { success: true, ...result };
  },
};
