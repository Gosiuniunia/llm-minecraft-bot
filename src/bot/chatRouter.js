/**
 * ChatRouter — listens to chat, dispatches tasks, handles special commands.
 *
 * Commands:
 *   llm-bot <goal>       → recursive dependency resolution + execution
 *   llm-bot retrieve     → bot walks to player and drops all items
 *   llm-bot follow       → bot follows the player
 *   llm-bot stop         → cancels current task / stops following
 *   llm-bot inventory    → lists what the bot is carrying
 */

import * as pathfinderPkg from "mineflayer-pathfinder";
const { pathfinder, goals, Movements } = pathfinderPkg;
import { logger } from "../utils/logger.js";

// GoalFollow exists only in newer pathfinder — build a safe wrapper
function makeFollowGoal(entity, distance) {
  // GoalFollow tracks a moving entity natively
  if (goals.GoalFollow) {
    return new goals.GoalFollow(entity, distance);
  }
  // Fallback: GoalNear snaps to current position (re-set every tick via interval)
  const pos = entity.position;
  return new goals.GoalNear(pos.x, pos.y, pos.z, distance);
}

export class ChatRouter {
  constructor(bot, agent, botConfig, home = null) {
    this.bot = bot;
    this.agent = agent;
    this.home = home;
    this.prefix = botConfig.triggerPrefix.toLowerCase();
    this.cooldownMs = botConfig.commandCooldownMs;

    this.cooldowns = new Map();
    this.activeTasks = new Map();
    this.followingPlayer = null;
    this._followInterval = null;
  }

  start() {
    this.bot.on("chat", (username, message) => {
      this._handleChat(username, message).catch((err) =>
        logger.error("ChatRouter error:", err)
      );
    });

    // After spawn, walk to the nearest player
    this.bot.once("spawn", () => {
      setTimeout(() => this._goToNearestPlayer(), 3000);
    });

    logger.info(`ChatRouter ready. Prefix: "${this.prefix}"`);
  }

  // ── Main chat handler ────────────────────────────────────────────

  async _handleChat(username, message) {
    if (username === this.bot.username) return;

    const lower = message.trim().toLowerCase();
    if (!lower.startsWith(this.prefix)) return;

    const rest = message.slice(this.prefix.length).trim();
    const command = rest.toLowerCase();

    // ── Built-in commands ────────────────────────────────────────
    if (command === "stop") {
      this._cancelTask(username);
      this._stopFollowing();
      try { this.bot.pathfinder.setGoal(null); } catch {}
      this.bot.chat(`@${username} Stopped everything.`);
      return;
    }

    if (command === "home" || command === "go home" || command === "return home") {
      this._cancelTask(username);
      this._stopFollowing();
      if (this.home) {
        this.bot.chat(`@${username} Going home (${this.home.homeString()})...`);
        await this.home.goHome();
        this.bot.chat(`@${username} I'm home!`);
      } else {
        this.bot.chat(`@${username} I don't know where home is!`);
      }
      return;
    }

    if (command === "follow") {
      this._cancelTask(username);
      this._startFollowing(username);
      this.bot.chat(`@${username} Following you!`);
      return;
    }

    if (command === "inventory") {
      const items = this.bot.inventory.items();
      if (items.length === 0) {
        this.bot.chat(`@${username} My inventory is empty.`);
      } else {
        const list = items.map((i) => `${i.name}x${i.count}`).join(", ");
        this.bot.chat(`@${username} Carrying: ${list}`);
      }
      return;
    }

    if (command === "retrieve") {
      this._cancelTask(username);
      await this._retrieve(username);
      return;
    }

    if (!rest) {
      this.bot.chat(`@${username} Give me a goal! e.g. "${this.prefix} get wooden_pickaxe"`);
      return;
    }

    // ── Natural language aliases for built-in commands ───────────
    // Catch "follow me", "come here", "come to me" etc. before sending to LLM
    const FOLLOW_PHRASES = ["follow me","come here","come to me","follow","come","get to me","get to me!","go to me"];
    const RETRIEVE_PHRASES = ["give me everything","give me your stuff","drop everything","retrieve","give me items"];
    const STOP_PHRASES = ["stop","cancel","nevermind","stop it","halt"];

    if (FOLLOW_PHRASES.includes(command)) {
      this._cancelTask(username);
      this._startFollowing(username);
      this.bot.chat(`@${username} Coming to you and following!`);
      // Also immediately go to them once
      this._goToPlayer(username);
      return;
    }

    if (RETRIEVE_PHRASES.includes(command)) {
      this._cancelTask(username);
      await this._retrieve(username);
      return;
    }

    if (STOP_PHRASES.includes(command)) {
      this._cancelTask(username);
      this._stopFollowing();
      try { this.bot.pathfinder.setGoal(null); } catch {}
      this.bot.chat(`@${username} Stopped.`);
      return;
    }

    // ── Cooldown ─────────────────────────────────────────────────
    const lastUsed = this.cooldowns.get(username) ?? 0;
    const elapsed = Date.now() - lastUsed;
    if (elapsed < this.cooldownMs) {
      const secs = Math.ceil((this.cooldownMs - elapsed) / 1000);
      this.bot.chat(`@${username} Wait ${secs}s.`);
      return;
    }
    this.cooldowns.set(username, Date.now());

    // ── Run task ─────────────────────────────────────────────────
    this._cancelTask(username);
    const controller = new AbortController();
    this.activeTasks.set(username, controller);

    logger.info(`Task from ${username}: "${rest}"`);
    this.bot.chat(`@${username} Working on: "${rest}"`);

    try {
      const summary = await this.agent.runTask(
        rest,
        controller.signal,
        (update) => this.bot.chat(`[Bot] ${update}`)
      );

      if (!controller.signal.aborted) {
        this.bot.chat(`@${username} Done! ${summary}`);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        this.bot.chat(`@${username} Task cancelled.`);
      } else {
        logger.error("Task error:", err);
        const msg = err?.message || JSON.stringify(err) || "Unknown error";
        this.bot.chat(`@${username} Failed: ${msg}`);
      }
    } finally {
      this.activeTasks.delete(username);
    }
  }

  // ── Retrieve: walk to player and drop everything ─────────────────

  async _retrieve(username) {
    const player = this.bot.players[username];
    if (!player?.entity) {
      this.bot.chat(`@${username} Can't see you — get closer first.`);
      return;
    }

    this.bot.chat(`@${username} Coming to you!`);

    try {
      const pos = player.entity.position;
      await this.bot.pathfinder.goto(
        new goals.GoalNear(pos.x, pos.y, pos.z, 2)
      );

      const items = [...this.bot.inventory.items()];
      if (items.length === 0) {
        this.bot.chat(`@${username} Nothing to give — I'm empty!`);
        return;
      }

      for (const item of items) {
        await this.bot.toss(item.type, null, item.count);
        await new Promise((r) => setTimeout(r, 200));
      }

      this.bot.chat(`@${username} Dropped everything for you!`);
    } catch (err) {
      logger.error("Retrieve error:", err);
      this.bot.chat(`@${username} Retrieve failed: ${err.message}`);
    }
  }

  // ── Follow player ────────────────────────────────────────────────

  _startFollowing(username) {
    this._stopFollowing();
    this.followingPlayer = username;

    const FOLLOW_DIST = 3;
    const STOP_DIST   = 2; // stop jittering when very close

    this._followInterval = setInterval(() => {
      if (!this.followingPlayer) return;
      const player = this.bot.players[this.followingPlayer];
      if (!player?.entity) return;

      const dist = this.bot.entity.position.distanceTo(player.entity.position);

      if (dist <= STOP_DIST) {
        // Very close — cancel goal so bot doesn't jitter in place
        try { this.bot.pathfinder.setGoal(null); } catch {}
        return;
      }

      if (dist > FOLLOW_DIST) {
        try {
          const pos = player.entity.position;
          // Always use GoalNear — most reliable across all pathfinder versions
          this.bot.pathfinder.setGoal(
            new goals.GoalNear(pos.x, pos.y, pos.z, FOLLOW_DIST),
            true  // dynamic = recalculate as player moves
          );
        } catch (err) {
          logger.warn("Follow setGoal error:", err.message);
        }
      }
    }, 500);
  }

  _stopFollowing() {
    this.followingPlayer = null;
    if (this._followInterval) {
      clearInterval(this._followInterval);
      this._followInterval = null;
    }
  }

  // ── Go to nearest player on spawn ───────────────────────────────

  async _goToNearestPlayer() {
    const players = Object.values(this.bot.players).filter(
      (p) => p.username !== this.bot.username && p.entity
    );

    if (players.length === 0) {
      logger.info("No players found on spawn — waiting for someone to join.");
      // Retry after 10 s in case world is still loading
      setTimeout(() => this._goToNearestPlayer(), 10_000);
      return;
    }

    const nearest = players.sort(
      (a, b) =>
        a.entity.position.distanceTo(this.bot.entity.position) -
        b.entity.position.distanceTo(this.bot.entity.position)
    )[0];

    logger.info(`Going to nearest player: ${nearest.username}`);

    try {
      const pos = nearest.entity.position;
      await this.bot.pathfinder.goto(
        new goals.GoalNear(pos.x, pos.y, pos.z, 3)
      );
      this.bot.chat(
        `Hi ${nearest.username}! Say "${this.prefix} get wooden_pickaxe" to give me a task, or "${this.prefix} follow" to have me follow you.`
      );
    } catch (err) {
      logger.warn("Could not go to nearest player:", err.message);
      this.bot.chat(`Hi! I'm LLMBot — say "${this.prefix} follow" so I can find you!`);
    }
  }

  // ── Go to a specific named player ───────────────────────────────

  async _goToPlayer(username) {
    const player = this.bot.players[username];
    if (!player?.entity) return;
    try {
      const pos = player.entity.position;
      await this.bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
    } catch {
      // player moved — follow interval will handle it
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  _cancelTask(username) {
    if (this.activeTasks.has(username)) {
      this.activeTasks.get(username).abort();
      this.activeTasks.delete(username);
    }
  }
}
