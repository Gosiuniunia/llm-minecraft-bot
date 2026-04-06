/**
 * LLMAgent — recursive dependency resolver.
 *
 * Asks ONE question at a time: "what do I need to get X?"
 * Resolves dependencies bottom-up before acting.
 *
 * Fixes vs previous version:
 * - any_log counted as a group (oak+birch+spruce+...)
 * - any_planks counted as a group
 * - inventory checked AFTER each step, not before
 * - survival loop: escape if suffocating or low health
 * - no hardcoded oak_log — always uses "any_log"
 */

import { createLLMProvider } from "./providers/providerFactory.js";
import { DEPS_PROMPT, SUMMARY_PROMPT } from "./systemPrompt.js";
import { logger } from "../utils/logger.js";

const MAX_DEPTH   = 8;
const MAX_VISITED = 40;

const ALL_LOG_NAMES = [
  "oak_log","birch_log","spruce_log","jungle_log",
  "acacia_log","dark_oak_log","mangrove_log","cherry_log",
];
const ALL_PLANK_NAMES = [
  "oak_planks","birch_planks","spruce_planks","jungle_planks",
  "acacia_planks","dark_oak_planks","mangrove_planks","cherry_planks",
];

export class LLMAgent {
  constructor(llmConfig, toolRegistry, home = null) {
    this.provider = createLLMProvider(llmConfig);
    this.tools    = toolRegistry;
    this.home     = home;
  }

  async runTask(goal, signal, onUpdate) {
    this.signal   = signal;
    this.onUpdate = onUpdate;
    this.visited  = new Set();

    // Start survival monitor
    const stopSurvival = this._startSurvivalMonitor();

    const targetItem = this._parseGoal(goal);
    onUpdate(`Goal: get ${targetItem}`);

    let summary;
    try {
      await this._resolveItem(targetItem, 0);
      summary = await this._summarise(goal);
    } catch (err) {
      if (err.name === "AbortError") { stopSurvival(); throw err; }
      logger.error("Task failed:", err);
      summary = null;
      stopSurvival();
      if (this.home) {
        onUpdate("Returning home after failure...");
        await this.home.goHome().catch(() => {});
      }
      return `Failed: ${err.message ?? JSON.stringify(err)}`;
    }

    stopSurvival();
    if (this.home) {
      onUpdate("Task done, returning home...");
      await this.home.goHome().catch(() => {});
    }
    return summary;
  }

  // ── Recursive resolver ───────────────────────────────────────────

  async _resolveItem(itemName, depth, count = 1) {
    if (this.signal.aborted) throw new DOMException("Aborted","AbortError");
    if (depth > MAX_DEPTH) throw new Error(`Too deep for "${itemName}"`);
    if (this.visited.size > MAX_VISITED) throw new Error("Too many steps");

    const key = `${itemName}:${depth}`;
    if (this.visited.has(key)) return;
    this.visited.add(key);

    // Check inventory — count any_log / any_planks as groups
    const have = this._countItem(itemName);
    if (have >= count) {
      logger.info(`Have ${have}x ${itemName} — skip`);
      return;
    }

    const need = count - have;
    this.onUpdate(`Need ${need}x ${itemName} (have ${have})`);

    const deps = await this._askDeps(itemName, need);
    this.onUpdate(deps.comment);
    logger.info(`Deps for ${itemName}:`, deps);

    // Resolve all dependencies first
    for (const dep of deps.needs) {
      // Normalise: any_log is accepted, resolve to "any_log"
      const depName = _normaliseItem(dep.item);
      await this._resolveItem(depName, depth + 1, dep.count);
    }

    // Resolve crafting table if needed
    if (deps.needs_table) {
      await this._ensureCraftingTable(depth);
    }

    // Now acquire the item
    await this._acquire(itemName, need, deps);
  }

  async _ensureCraftingTable(depth) {
    const bot = this.tools.bot;
    // Already in world?
    if (bot.findBlock({
      matching: bot.registry.blocksByName["crafting_table"]?.id,
      maxDistance: 16,
    })) return;

    // Have one in inventory?
    if (this._countItem("crafting_table") > 0) {
      // Just place it — craftingTool handles this internally
      return;
    }

    // Need to craft one first (recursively)
    await this._resolveItem("crafting_table", depth + 1, 1);
  }

  // ── Acquire item ─────────────────────────────────────────────────

  async _acquire(itemName, count, deps) {
    if (deps.action === "craft") {
      await this._doCraft(itemName, count);
    } else {
      // mine
      const blockType = ITEM_TO_BLOCK[itemName] ?? itemName;
      await this._doMine(blockType, count, deps.tool ?? null);
    }
  }

  async _doCraft(itemName, count) {
    this.onUpdate(`Crafting ${count}x ${itemName}...`);

    // Re-check inventory right before craft — previous steps may have produced enough
    const have = this._countItem(itemName);
    if (have >= count) {
      logger.info(`Already have ${have}x ${itemName} after deps, skip craft`);
      return;
    }

    const result = await this.tools.execute("craft_item", { itemName, count });

    if (!result.success) {
      throw new Error(result.error ?? `craft_item failed for ${itemName}`);
    }

    // Wait for inventory to settle
    await _sleep(600);
    this.onUpdate(`Crafted ${count}x ${itemName} ✓`);
  }

  async _doMine(blockType, count, toolRequired) {
    this.onUpdate(`Mining ${count}x ${blockType}...`);

    if (toolRequired) {
      const eq = await this.tools.execute("equip_item", {
        itemName: toolRequired,
        destination: "hand",
      });
      if (!eq.success) logger.warn(`Equip ${toolRequired} failed: ${eq.error}`);
    }

    const result = await this.tools.execute("mine_block", {
      blockType,
      count,
      maxDistance: 64,
    });

    if (!result.success && (result.mined ?? 0) === 0) {
      throw new Error(result.error ?? `mine_block failed for ${blockType}`);
    }

    await _sleep(500);
    this.onUpdate(`Mined ${result.mined ?? count}x ${blockType} ✓`);
  }

  // ── LLM call ─────────────────────────────────────────────────────

  async _askDeps(itemName, count) {
    const messages = [{
      role: "user",
      content: `What do I need to obtain ${count}x ${itemName}? Reply JSON only.`,
    }];

    const response = await this.provider.chat({
      systemPrompt: DEPS_PROMPT,
      messages,
      tools: [],
    });

    const raw = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim()
      .replace(/^```(?:json)?\n?/,"")
      .replace(/\n?```$/,"")
      .trim();

    try {
      const p = JSON.parse(raw);
      return {
        action:      p.action ?? "mine",
        needs:       Array.isArray(p.needs) ? p.needs : [],
        needs_table: p.needs_table === true,
        tool:        p.tool_required ?? null,
        comment:     p.comment ?? `Getting ${itemName}...`,
      };
    } catch {
      logger.warn(`Bad JSON from LLM for "${itemName}":`, raw);
      // Fallback: treat as mineable
      return { action:"mine", needs:[], needs_table:false, tool:null, comment:`Mining ${itemName}` };
    }
  }

  // ── Survival monitor ─────────────────────────────────────────────

  _startSurvivalMonitor() {
    const bot = this.tools.bot;
    let busy = false;

    const interval = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        // Escape suffocation: if bot is inside a block, dig up
        const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
        const feet = bot.blockAt(bot.entity.position);
        const isSuffocating = (head && !NON_SOLID.has(head.name)) ||
                              (feet && !NON_SOLID.has(feet.name));

        if (isSuffocating) {
          logger.warn("Bot suffocating — digging up!");
          this.onUpdate("Suffocating — digging out!");
          // Try digging the block above
          const above = bot.blockAt(bot.entity.position.offset(0, 2, 0));
          if (above && !NON_SOLID.has(above.name)) {
            try { await bot.dig(above); } catch {}
          }
          const aboveHead = bot.blockAt(bot.entity.position.offset(0, 1, 0));
          if (aboveHead && !NON_SOLID.has(aboveHead.name)) {
            try { await bot.dig(aboveHead); } catch {}
          }
          // Jump
          bot.setControlState("jump", true);
          await _sleep(500);
          bot.setControlState("jump", false);
        }

        // Low health warning
        if (bot.health !== null && bot.health < 6) {
          logger.warn(`Low health: ${bot.health}`);
          this.onUpdate(`Warning: health ${bot.health}/20 — be careful!`);
        }
      } catch {}
      busy = false;
    }, 1000);

    return () => clearInterval(interval);
  }

  // ── Helpers ──────────────────────────────────────────────────────

  _countItem(itemName) {
    const bot = this.tools.bot;
    const items = bot.inventory.items();

    // any_log or specific log → count all log types
    if (itemName === "any_log" || ALL_LOG_NAMES.includes(itemName)) {
      return items
        .filter(i => ALL_LOG_NAMES.includes(i.name))
        .reduce((s,i) => s+i.count, 0);
    }

    // any_planks or specific planks → count all plank types
    if (itemName === "any_planks" || ALL_PLANK_NAMES.includes(itemName)) {
      return items
        .filter(i => ALL_PLANK_NAMES.includes(i.name))
        .reduce((s,i) => s+i.count, 0);
    }

    const id = bot.registry.itemsByName[itemName]?.id;
    if (!id) return 0;
    return items.filter(i => i.type === id).reduce((s,i) => s+i.count, 0);
  }

  _parseGoal(goal) {
    let s = goal.trim().toLowerCase();
    s = s.replace(/^(get|craft|make|find|obtain|acquire|bring me|give me|collect|mine)\s+/, "");
    s = s.replace(/^(a|an|some|\d+)\s+/, "");
    s = s.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    const PLURAL = {
      sticks:"stick", logs:"any_log", diamonds:"diamond",
      emeralds:"emerald", coals:"coal", torches:"torch",
      wooden_pickaxes:"wooden_pickaxe", stone_pickaxes:"stone_pickaxe",
      iron_pickaxes:"iron_pickaxe", diamond_pickaxes:"diamond_pickaxe",
      pickaxes:"stone_pickaxe", shovels:"stone_shovel", axes:"stone_axe",
      // typo tolerance
      pixac:"pickaxe", pikaxe:"pickaxe", pickaxe:"stone_pickaxe",
      shovel:"stone_shovel", axe:"stone_axe", sword:"stone_sword",
    };
    return PLURAL[s] ?? s;
  }

  async _summarise(goal) {
    try {
      const inv = this.tools.bot.inventory.items()
        .map(i=>`${i.name}x${i.count}`).join(", ") || "empty";
      const r = await this.provider.chat({
        systemPrompt: SUMMARY_PROMPT,
        messages: [{ role:"user", content:`Goal: "${goal}". Inventory now: ${inv}. Summarise.` }],
        tools: [],
      });
      return r.content.filter(b=>b.type==="text").map(b=>b.text).join("").trim() || "Done!";
    } catch { return "Task completed."; }
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const NON_SOLID = new Set([
  "air","cave_air","void_air","water","lava","grass","tall_grass",
  "fern","dead_bush","dandelion","poppy","blue_orchid","allium",
  "torch","wall_torch","ladder","vine","snow","sugar_cane",
]);

const ITEM_TO_BLOCK = {
  any_log:"any_log", oak_log:"any_log", birch_log:"any_log",
  spruce_log:"any_log", jungle_log:"any_log", acacia_log:"any_log",
  dark_oak_log:"any_log",
  cobblestone:"stone", stone:"stone",
  coal:"coal_ore", iron_ingot:"iron_ore", raw_iron:"iron_ore",
  gold_ingot:"gold_ore", raw_gold:"gold_ore",
  diamond:"diamond_ore", emerald:"emerald_ore",
};

function _normaliseItem(name) {
  if (!name) return name;
  const s = String(name).toLowerCase().trim();
  // Any log request → use any_log alias
  if (ALL_LOG_NAMES.includes(s) || s === "log") return "any_log";
  // Any plank request → use oak_planks (craftingTool handles any planks)
  if (ALL_PLANK_NAMES.includes(s) || s === "planks") return "oak_planks";
  return s;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
