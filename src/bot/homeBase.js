/**
 * HomeBase — remembers where the bot spawned and provides a goHome() method.
 *
 * The spawn position is recorded on the first "spawn" event.
 * goHome() pathfinds back to that position — called after every task
 * completes or errors, and after errors/kicks.
 */

import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
import { logger } from "../utils/logger.js";

export class HomeBase {
  constructor(bot) {
    this.bot = bot;
    this.home = null; // { x, y, z }
  }

  /** Call once after spawn to lock in the home position. */
  recordSpawn() {
    const pos = this.bot.entity.position;
    this.home = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    logger.info(`Home base recorded: x=${this.home.x} y=${this.home.y} z=${this.home.z}`);
  }

  /** Pathfind back to spawn. Resolves even if pathfinding fails. */
  async goHome() {
    if (!this.home) {
      logger.warn("goHome called but no home recorded yet.");
      return;
    }

    const pos = this.bot.entity.position;
    const dist = Math.sqrt(
      (pos.x - this.home.x) ** 2 +
      (pos.y - this.home.y) ** 2 +
      (pos.z - this.home.z) ** 2
    );

    if (dist < 4) {
      logger.debug("Already near home — skipping goHome.");
      return;
    }

    logger.info(`Returning home (${dist.toFixed(0)} blocks away)...`);
    try {
      await this.bot.pathfinder.goto(
        new goals.GoalNear(this.home.x, this.home.y, this.home.z, 3)
      );
      logger.info("Arrived home.");
    } catch (err) {
      // Path may be blocked — just log and continue, don't crash
      logger.warn(`Could not reach home: ${err.message}`);
    }
  }

  homeString() {
    if (!this.home) return "unknown";
    return `x=${this.home.x} y=${this.home.y} z=${this.home.z}`;
  }
}
