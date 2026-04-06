/**
 * minecraft-llm-bot — entry point
 */

import "dotenv/config";
import { createBot } from "./bot/botFactory.js";
import { ChatRouter } from "./bot/chatRouter.js";
import { LLMAgent } from "./llm/llmAgent.js";
import { buildToolRegistry } from "./tools/toolRegistry.js";
import { HomeBase } from "./bot/homeBase.js";
import { logger } from "./utils/logger.js";
import { loadConfig } from "./utils/config.js";

const config = loadConfig();

logger.info("Starting Minecraft LLM Bot…");
logger.info(`  Server  : ${config.mc.host}:${config.mc.port}`);
logger.info(`  Username: ${config.mc.username}`);
logger.info(`  Provider: ${config.llm.provider}`);

const bot = createBot(config.mc);

bot.once("spawn", () => {
  logger.info("Bot spawned in the world.");

  const home = new HomeBase(bot);
  home.recordSpawn();

  const tools = buildToolRegistry(bot);
  const agent = new LLMAgent(config.llm, tools, home);
  const router = new ChatRouter(bot, agent, config.bot, home);

  router.start();

  bot.chat(`LLMBot online! Home: ${home.homeString()}. Say "llm-bot follow" to call me.`);
});

bot.on("error", (err) => logger.error("Bot error:", err));

bot.on("kicked", (reason) => {
  logger.warn("Kicked:", reason);
});

bot.on("end", () => {
  logger.warn("Disconnected — restarting in 5s…");
  setTimeout(() => process.exit(1), 5_000);
});
