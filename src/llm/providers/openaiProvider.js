/**
 * OpenAIProvider — calls the OpenAI Chat Completions API.
 * Also works with any OpenAI-compatible endpoint (LM Studio, vLLM, etc.)
 * by overriding OPENAI_BASE_URL in .env.
 */

import OpenAI from "openai";
import { logger } from "../../utils/logger.js";

export class OpenAIProvider {
  constructor({ apiKey, model }) {
    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL, // optional override
    });
    this.model = model;
  }

  async chat({ systemPrompt, messages, tools }) {
    const openaiMessages = buildOpenAIMessages(systemPrompt, messages);
    const openaiTools = tools.map(schemaToOpenAITool);

    logger.debug(`OpenAI request → model=${this.model}, messages=${openaiMessages.length}`);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: "auto",
    });

    return normalizeOpenAIResponse(response.choices[0].message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildOpenAIMessages(systemPrompt, messages) {
  const result = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "tool") {
      for (const r of msg.content) {
        result.push({
          role: "tool",
          tool_call_id: r.toolCallId,
          content: JSON.stringify(r.result),
        });
      }
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const toolCalls = msg.content
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      result.push({ role: "assistant", content: textBlocks || null, tool_calls: toolCalls });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  return result;
}

function schemaToOpenAITool(schema) {
  return {
    type: "function",
    function: {
      name: schema.name,
      description: schema.description,
      parameters: schema.inputSchema,
    },
  };
}

function normalizeOpenAIResponse(message) {
  const toolCalls = (message.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }));

  return {
    content: [{ type: "text", text: message.content ?? "" }],
    toolCalls,
  };
}
