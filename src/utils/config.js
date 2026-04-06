/**
 * Configuration loader — reads environment variables and validates them.
 * Call loadConfig() once at startup; pass the returned object everywhere.
 */

export function loadConfig() {
  const provider = requireEnv("LLM_PROVIDER", "ollama");

  return {
    mc: {
      host: process.env.MC_HOST ?? "localhost",
      port: parseInt(process.env.MC_PORT ?? "25565", 10),
      username: process.env.MC_USERNAME ?? "LLMBot",
      version: process.env.MC_VERSION ?? "1.20.1",
      auth: "offline", // use "microsoft" for online-mode servers
    },

    llm: {
      provider,
      ollama: {
        host: process.env.OLLAMA_HOST ?? "http://localhost:11434",
        model: process.env.OLLAMA_MODEL ?? "llama3.2",
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022",
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY ?? "",
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      },
    },

    bot: {
      triggerPrefix: process.env.TRIGGER_PREFIX ?? "llm-bot",
      maxSteps: parseInt(process.env.MAX_STEPS ?? "20", 10),
      commandCooldownMs: parseInt(process.env.COMMAND_COOLDOWN_MS ?? "5000", 10),
    },
  };
}

function requireEnv(key, fallback) {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}
