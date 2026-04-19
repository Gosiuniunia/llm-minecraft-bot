/**
 * botFactory — creates and configures the Mineflayer bot instance.
 */

import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import collectBlockPkg from "mineflayer-collectblock";
import pvpPkg from "mineflayer-pvp";
import { logger } from "../utils/logger.js";

const { pathfinder, Movements } = pathfinderPkg;

const collectBlock =
  collectBlockPkg.collectBlockPlugin ??
  collectBlockPkg.plugin ??
  collectBlockPkg.default ??
  collectBlockPkg;

const pvpLoader =
  pvpPkg.plugin ??
  pvpPkg.default ??
  pvpPkg;

if (typeof collectBlock !== "function") throw new Error("collectBlock plugin is not a function");
if (typeof pvpLoader !== "function") throw new Error("pvp plugin is not a function");

export function createBot(mcConfig) {
  const bot = mineflayer.createBot({
    host: mcConfig.host,
    port: mcConfig.port,
    username: mcConfig.username,
    version: mcConfig.version,
    auth: mcConfig.auth,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvpLoader);

  bot.once("spawn", () => {
    const movements = new Movements(bot);
    movements.canDig = false;        // don't randomly dig while pathfinding
    movements.canDigDown = false;    // never dig straight down (safety)
    movements.allowSprinting = true;
    movements.maxDropDown = 4;       // don't jump off cliffs > 4 blocks
    bot.pathfinder.setMovements(movements);
    logger.debug("Pathfinder movements configured.");
  });

  return bot;
}
