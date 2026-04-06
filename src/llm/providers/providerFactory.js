/**
 * providerFactory — returns the correct LLM provider adapter based on config.
 *
 * All providers expose the same interface:
 *   provider.chat({ systemPrompt, messages, tools }) → NormalizedResponse
 */

import { OllamaProvider } from "./ollamaProvider.js";
import { AnthropicProvider } from "./anthropicProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";

/**
 * @param {object} llmConfig  The llm section from loadConfig()
 */
export function createLLMProvider(llmConfig) {
  switch (llmConfig.provider) {
    case "ollama":
      return new OllamaProvider(llmConfig.ollama);
    case "anthropic":
      return new AnthropicProvider(llmConfig.anthropic);
    case "openai":
      return new OpenAIProvider(llmConfig.openai);
    default:
      throw new Error(`Unknown LLM provider: "${llmConfig.provider}". Choose ollama | anthropic | openai`);
  }
}
