import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';

const EPHEMERAL_DELETE_AFTER_MS = 3000;

export async function replyEphemeralThenDelete(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral
  });
  setTimeout(() => {
    void interaction.deleteReply().catch(() => undefined);
  }, EPHEMERAL_DELETE_AFTER_MS);
}
