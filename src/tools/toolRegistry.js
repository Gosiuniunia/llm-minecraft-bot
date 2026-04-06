/**
 * ToolRegistry — central registry for all Minecraft action tools.
 *
 * Each tool module exports:
 *   { schema, execute }
 *
 * schema  → JSON-Schema-compatible descriptor (name, description, inputSchema)
 * execute → async (bot, args) => result object
 *
 * The registry exposes:
 *   getSchemas() → array of schemas for the LLM
 *   execute(name, args) → calls the matching tool
 */

import { logger } from "../utils/logger.js";

import { moveTool } from "./moveTool.js";
import { miningTool } from "./miningTool.js";
import { inventoryTool } from "./inventoryTool.js";
import { craftingTool } from "./craftingTool.js";
import { placeBlockTool } from "./placeBlockTool.js";
import { inspectTool } from "./inspectTool.js";
import { equipTool } from "./equipTool.js";
import { attackTool } from "./attackTool.js";
import { chatTool } from "./chatTool.js";
import { giveTool } from "./giveTool.js";

const ALL_TOOLS = [
  moveTool,
  miningTool,
  inventoryTool,
  craftingTool,
  placeBlockTool,
  inspectTool,
  equipTool,
  attackTool,
  chatTool,
  giveTool,
];

export function buildToolRegistry(bot) {
  const registry = new Map();

  for (const tool of ALL_TOOLS) {
    if (registry.has(tool.schema.name)) {
      throw new Error(`Duplicate tool name: ${tool.schema.name}`);
    }
    registry.set(tool.schema.name, tool);
  }

  return {
    /** Expose the bot for snapshot building in the agent */
    bot,

    /** Return all tool schemas for the LLM */
    getSchemas() {
      return Array.from(registry.values()).map((t) => t.schema);
    },

    /** Execute a named tool */
    async execute(name, args) {
      const tool = registry.get(name);
      if (!tool) throw new Error(`Unknown tool: "${name}"`);

      logger.debug(`Executing tool "${name}" with`, args);
      return tool.execute(bot, args);
    },
  };
}
