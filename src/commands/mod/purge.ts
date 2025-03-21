import {
  CommandInteraction,
  SlashCommandBuilder,
  SlashCommandNumberOption,
  TextChannel
} from 'discord.js';
import { Discord, Slash, SlashOption } from 'discordx';

const command = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('moderator command to delete up to 100 messages!');

const option = new SlashCommandNumberOption()
  .setName('messages')
  .setDescription('Number of messages to delete')
  .setRequired(true);

@Discord()
export class Purge {
  @Slash(command)
  async purge(
    @SlashOption(option) messages: number,
    interaction: CommandInteraction
  ): Promise<void> {
    if (messages > 100) {
      await interaction.reply(
        'You can only delete up to 100 messages at a time!'
      );
      return void setTimeout(() => interaction.deleteReply(), 5000);
    }

    if (!interaction.channel?.isTextBased()) {
      await interaction.reply('This command only works in text channels!');
      return void setTimeout(() => interaction.deleteReply(), 5000);
    }

    try {
      await (interaction.channel as TextChannel).bulkDelete(messages, true);
      await interaction.reply(`Deleted ${messages} messages!`);
      return void setTimeout(() => interaction.deleteReply(), 5000);
    } catch (error) {
      console.error(error);
      await interaction.reply(
        'An error occurred while trying to delete messages!'
      );
      return void setTimeout(() => interaction.deleteReply(), 5000);
    }
  }
}
