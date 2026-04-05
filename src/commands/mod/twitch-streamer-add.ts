import { ApplicationCommandOptionType, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Discord, Slash, SlashOption } from 'discordx';
import { replyEphemeralThenDelete } from '../../ulits/discord-ephemeral.js';

@Discord()
export class TwitchStreamerAdd {
  @Slash({
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    description: 'Add a Twitch channel to live notifications (saved in data/twitch-streamers.json)',
    dmPermission: false,
    name: 'twitch-streamer-add'
  })
  async add(
    @SlashOption({
      description: 'Twitch username (login)',
      maxLength: 25,
      minLength: 4,
      name: 'login',
      required: true,
      type: ApplicationCommandOptionType.String
    })
    login: string,
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    try {
      const twitch = interaction.client.twitchService;
      if (!twitch) {
        await replyEphemeralThenDelete(interaction, 'Twitch integration is not ready yet.');
        return;
      }
      const result = await twitch.addStreamer(login);
      if (result.ok) {
        await replyEphemeralThenDelete(interaction, `Added **${result.login}** to Twitch live notifications.`);
      } else {
        await replyEphemeralThenDelete(interaction, result.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await replyEphemeralThenDelete(interaction, `Could not add streamer: ${msg}`);
    }
  }
}
