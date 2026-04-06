/**
 * moveTool — navigate the bot to a world position using pathfinder.
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { logger } from "../utils/logger.js";

export const moveTool = {
  schema: {
    name: "move_to",
    description:
      "Move the bot to the specified world coordinates. Use this to walk to a location, block, or entity position.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Target X coordinate" },
        y: { type: "number", description: "Target Y coordinate" },
        z: { type: "number", description: "Target Z coordinate" },
        range: {
          type: "number",
          description: "How close to get (in blocks). Default 1.",
          default: 1,
        },
      },
      required: ["x", "y", "z"],
    },
  },

  async execute(bot, { x, y, z, range = 1 }) {
    const goal = new goals.GoalNear(x, y, z, range);

    return new Promise((resolve, reject) => {
      bot.pathfinder.setGoal(goal);

      bot.once("goal_reached", () => {
        const pos = bot.entity.position;
        resolve({
          success: true,
          position: { x: pos.x.toFixed(2), y: pos.y.toFixed(2), z: pos.z.toFixed(2) },
        });
      });

      bot.once("path_update", (result) => {
        if (result.status === "noPath") {
          reject(new Error("No path found to destination."));
        }
      });
    });
  },
};
