/**
 * attackTool — attack an entity by its ID or by searching for the nearest
 * entity of a given type.
 *
 * Uses mineflayer-pvp for sustained combat when fighting mobs.
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { logger } from "../utils/logger.js";

export const attackTool = {
  schema: {
    name: "attack_entity",
    description:
      "Attack an entity. Specify an entity ID (from inspect_surroundings) " +
      "or an entity type to attack the nearest one. " +
      "The bot will approach and fight until the target is dead or it cannot reach.",
    inputSchema: {
      type: "object",
      properties: {
        entityId: {
          type: "number",
          description: "Specific entity ID to attack (from inspect_surroundings results)",
        },
        entityType: {
          type: "string",
          description: "Attack the nearest entity of this type, e.g. 'zombie', 'cow'",
        },
        maxDistance: {
          type: "number",
          description: "Maximum search distance when using entityType. Default 16.",
          default: 16,
        },
      },
    },
  },

  async execute(bot, { entityId, entityType, maxDistance = 16 }) {
    let target;

    if (entityId !== undefined) {
      target = bot.entities[entityId];
      if (!target) return { success: false, error: `Entity ${entityId} not found` };
    } else if (entityType) {
      target = Object.values(bot.entities)
        .filter(
          (e) =>
            e !== bot.entity &&
            e.name === entityType &&
            e.position.distanceTo(bot.entity.position) <= maxDistance
        )
        .sort(
          (a, b) =>
            a.position.distanceTo(bot.entity.position) -
            b.position.distanceTo(bot.entity.position)
        )[0];

      if (!target) {
        return { success: false, error: `No "${entityType}" found within ${maxDistance} blocks` };
      }
    } else {
      return { success: false, error: "Provide either entityId or entityType" };
    }

    const targetName = target.name ?? target.username ?? String(entityId);
    logger.info(`Attacking ${targetName} (id=${target.id})`);

    // Walk close enough to attack
    await bot.pathfinder.goto(
      new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)
    );

    // Use pvp plugin for sustained combat
    if (bot.pvp) {
      return new Promise((resolve) => {
        bot.pvp.attack(target);

        const onStoppedAttacking = () => {
          resolve({ success: true, target: targetName, status: "defeated or lost" });
        };

        bot.pvp.once("stoppedAttacking", onStoppedAttacking);
      });
    }

    // Fallback: single swing
    bot.attack(target);
    return { success: true, target: targetName, status: "attacked once (pvp plugin unavailable)" };
  },
};
