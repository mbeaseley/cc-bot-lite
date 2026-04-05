import {
  CommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  SlashCommandNumberOption,
  TextChannel
} from 'discord.js';
import { Discord, Slash, SlashOption } from 'discordx';

const command = new SlashCommandBuilder().setName('purge').setDescription('moderator command to delete up to 100 messages!');

const option = new SlashCommandNumberOption().setName('messages').setDescription('Number of messages to delete').setRequired(true);

@Discord()
export class Purge {
  @Slash(command)
  async purge(@SlashOption(option) messages: number, interaction: CommandInteraction): Promise<void> {
    if (messages > 100) {
      await interaction.reply('You can only delete up to 100 messages at a time!');
      return void setTimeout(() => {
        void interaction.deleteReply();
      }, 5000);
    }

    if (!interaction.channel?.isTextBased()) {
      await interaction.reply('This command only works in text channels!');
      return void setTimeout(() => {
        void interaction.deleteReply();
      }, 5000);
    }

    const channel = interaction.channel as TextChannel;

    // Ephemeral so the "thinking" ack is not a normal channel message that bulkDelete can remove.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await channel.bulkDelete(messages, true);
      await this.finishPurgeReply(interaction, `Deleted ${String(messages)} messages!`);
    } catch (error) {
      console.error(error);
      await this.finishPurgeReply(interaction, 'An error occurred while trying to delete messages!');
    } finally {
      void setTimeout(() => {
        void interaction.deleteReply();
      }, 2000);
    }
  }

  private async finishPurgeReply(interaction: CommandInteraction, content: string): Promise<void> {
    try {
      await interaction.editReply({ content });
    } catch {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}
