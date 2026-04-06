/**
 * chatTool — send a message to the Minecraft in-game chat.
 *
 * Useful for the bot to give real-time narration, ask clarifying
 * questions, or report its progress to nearby players.
 */

export const chatTool = {
  schema: {
    name: "send_chat",
    description:
      "Send a message to the Minecraft in-game chat. " +
      "Use this to report progress, ask for clarification, or narrate what the bot is doing.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message to send. Max 256 characters.",
          maxLength: 256,
        },
      },
      required: ["message"],
    },
  },

  async execute(bot, { message }) {
    const truncated = message.slice(0, 256);
    bot.chat(truncated);
    return { success: true, sent: truncated };
  },
};
