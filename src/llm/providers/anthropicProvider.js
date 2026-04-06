/**
 * AnthropicProvider — calls the Anthropic Messages API.
 *
 * Normalized response shape (same as all providers):
 * {
 *   content: [{ type: "text", text: string }],
 *   toolCalls: [{ id, name, arguments }]
 * }
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../utils/logger.js";

export class AnthropicProvider {
  constructor({ apiKey, model }) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat({ systemPrompt, messages, tools }) {
    const anthropicMessages = buildAnthropicMessages(messages);
    const anthropicTools = tools.map(schemaToAnthropicTool);

    logger.debug(`Anthropic request → model=${this.model}, messages=${anthropicMessages.length}`);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    return normalizeAnthropicResponse(response);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAnthropicMessages(messages) {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "user",
        content: msg.content.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolCallId,
          content: JSON.stringify(r.result),
        })),
      };
    }
    return msg;
  });
}

function schemaToAnthropicTool(schema) {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: schema.inputSchema,
  };
}

function normalizeAnthropicResponse(response) {
  const toolCalls = response.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.input,
    }));

  return {
    content: response.content,
    toolCalls,
  };
}
