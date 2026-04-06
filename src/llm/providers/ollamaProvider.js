/**
 * OllamaProvider — runs tool-calling inference against a local Ollama instance.
 *
 * Ollama supports the OpenAI-compatible /api/chat endpoint with tool_calls
 * starting from version 0.3.x with models that support it (e.g. llama3.2,
 * mistral-nemo, qwen2.5).
 *
 * Normalized response shape:
 * {
 *   content: [{ type: "text", text: string }],
 *   toolCalls: [{ id, name, arguments }]  // may be empty
 * }
 */

import { Ollama } from "ollama";
import { logger } from "../../utils/logger.js";

export class OllamaProvider {
  constructor({ host, model }) {
    this.client = new Ollama({ host });
    this.model = model;
  }

  async chat({ systemPrompt, messages, tools }) {
    const ollamaMessages = buildOllamaMessages(systemPrompt, messages);
    const ollamaTools = tools.map(schemaToOllamaTool);

    logger.debug(`Ollama request → model=${this.model}, messages=${ollamaMessages.length}`);

    const response = await this.client.chat({
      model: this.model,
      messages: ollamaMessages,
      tools: ollamaTools,
    });

    return normalizeOllamaResponse(response.message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildOllamaMessages(systemPrompt, messages) {
  const result = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "tool") {
      // Ollama expects tool results as separate tool messages
      for (const r of msg.content) {
        result.push({
          role: "tool",
          content: JSON.stringify(r.result),
        });
      }
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const toolCalls = msg.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          function: { name: b.name, arguments: b.input },
        }));
      result.push({ role: "assistant", content: textBlocks, tool_calls: toolCalls });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

function schemaToOllamaTool(schema) {
  return {
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.inputSchema,
    },
  };
}

function normalizeOllamaResponse(message) {
  const toolCalls = (message.tool_calls ?? []).map((tc, idx) => ({
    id: `tc_${idx}`,
    name: tc.function.name,
    arguments:
      typeof tc.function.arguments === "string"
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments,
  }));

  return {
    content: [{ type: "text", text: message.content ?? "" }],
    toolCalls,
  };
}
