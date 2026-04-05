import { ApplicationCommandOptionType, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Discord, Slash, SlashOption } from 'discordx';
import { replyEphemeralThenDelete } from '../../ulits/discord-ephemeral.js';

@Discord()
export class TwitchStreamerRemove {
  @Slash({
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    description: 'Remove a Twitch channel from live notifications (updates data/twitch-streamers.json)',
    dmPermission: false,
    name: 'twitch-streamer-remove'
  })
  async remove(
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
      const result = await twitch.removeStreamer(login);
      if (result.ok) {
        const suffix = result.stillInEnv
          ? ' They are still listed in `TWITCH_STREAMER_*` environment variables — remove those or tracking returns after a bot restart.'
          : '';
        await replyEphemeralThenDelete(interaction, `Removed **${result.login}** from the saved notification list.${suffix}`);
      } else {
        await replyEphemeralThenDelete(interaction, result.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await replyEphemeralThenDelete(interaction, `Could not remove streamer: ${msg}`);
    }
  }
}
