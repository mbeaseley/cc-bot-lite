import axios from 'axios';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  TextChannel
} from 'discord.js';
import { Client } from 'discordx';

interface StatusItem {
  user?: Twitch.User;
  live: boolean;
  stream?: Twitch.Channel;
}
type StreamerStatus = Record<string, StatusItem>;

interface TwitchConfig {
  headers: Record<string, string>;
}

enum TwitchErrors {
  Unauthorized = 'Could not find Twitch client id or secret in your environment',
  MissingDiscordTextChannel = 'Could not find DISCORD_CHANNEL_ID in your environment',
  NoFoundDiscordTextChannel = 'Could not find channel',
  InvalidDiscordChannel = 'Could not find valid text channel'
}

export default class TwitchService {
  private readonly twitchClientID = process.env.TWITCH_CLIENT_ID;
  private readonly twitchSecret = process.env.TWITCH_SECRET;
  private twitchToken = '';
  private readonly discordChannelID = process.env.DISCORD_CHANNEL_ID;
  private twitchStreamerStatus: StreamerStatus = {};

  /**
   * Initialize the Twitch service
   * @returns {Promise<void>}
   */
  public async init(): Promise<void> {
    try {
      Object.keys(process.env)
        .filter((key) => key?.includes('TWITCH_STREAMER_'))
        .forEach((name) => {
          if (process.env[name]) {
            this.twitchStreamerStatus[process.env[name]] = {
              live: false
            };
          }
        });

      const res = await axios.post<never, Twitch.TwitchToken>(
        `https://id.twitch.tv/oauth2/token?client_id=${this.twitchClientID}&client_secret=${this.twitchSecret}&grant_type=client_credentials`
      );
      this.twitchToken = res.data.access_token;
    } catch (error) {
      throw Error(String(error));
    }
  }

  /**
   * Check the status of the streamers, if they are live or not
   * @returns {Promise<void>}
   */
  async checkStreamers(): Promise<void> {
    const promises = Object.keys(this.twitchStreamerStatus).map(
      async (streamer) => {
        const res = await axios.get<TwitchConfig, Twitch.TwitchSteam>(
          `https://api.twitch.tv/helix/streams?user_login=${streamer}`,
          {
            headers: {
              'Client-ID': this.twitchClientID,
              Authorization: `Bearer ${this.twitchToken}`
            }
          }
        );

        if (res.data.data.length > 0) {
          if (!this.twitchStreamerStatus[streamer].live) {
            this.twitchStreamerStatus[streamer] = {
              user: {
                id: res.data.data[0].user_id
              },
              live: true,
              stream: res.data.data[0]
            };
          } else {
            this.twitchStreamerStatus[streamer].stream = undefined;
          }
        } else {
          this.twitchStreamerStatus[streamer].live = false;
        }
      }
    );

    await Promise.all(promises);
    await this.getUsers();
  }

  /**
   * Send live notifications to the Discord channel set in the environment
   * @param bot
   * @returns {void}
   */
  public sendLiveNotifications(bot: Client): void {
    const channel = this.findLiveChannel(bot);

    if (!channel) {
      return;
    }

    Object.keys(this.twitchStreamerStatus).forEach((streamer) => {
      const { user, live, stream } = this.twitchStreamerStatus[streamer];

      if (live && stream && user) {
        console.log('Sending notification for', user.display_name);
        const message = new EmbedBuilder({
          title: stream?.title,
          author: {
            name: stream?.user_name,
            url: `https://www.twitch.tv/${stream?.user_name}`,
            icon_url: user?.profile_image_url
          },
          color: 6570405,
          thumbnail: user?.profile_image_url
            ? {
                url: user.profile_image_url
              }
            : undefined,
          image: {
            url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${stream.user_name.toLowerCase()}-1280x720.jpg`
          },
          fields: [
            {
              name: 'Game',
              value: stream?.game_name || 'Just Chatting', // Fallback is nice practice
              inline: true
            },
            {
              name: 'Started',
              value: `<t:${Math.floor(new Date(stream.started_at).getTime() / 1000)}:R>`,
              inline: true
            }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: 'Twitch',
            iconURL:
              'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png'
          }
        });

        const button = new ButtonBuilder()
          .setCustomId(`streamer-${stream.user_name}-cta`)
          .setLabel('Watch stream')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

        channel.send({
          content: `Hey @everyone, **${user?.display_name}** is live now!`,
          embeds: [message],
          components: [row]
        });
      }
    });
  }

  public checkTwitchEnvVars(): boolean {
    if (!this.twitchClientID || !this.twitchSecret) {
      throw Error(
        'Could not find Twitch client id or secret in your environment'
      );
    }

    return true;
  }

  public findLiveChannel(bot: Client): TextChannel | undefined {
    if (!this.discordChannelID) {
      throw Error(TwitchErrors.MissingDiscordTextChannel);
    }

    const channel = bot.channels.cache.get(this.discordChannelID);

    if (!channel) {
      throw Error(TwitchErrors.NoFoundDiscordTextChannel);
    }

    if (!(channel instanceof TextChannel)) {
      throw Error(TwitchErrors.InvalidDiscordChannel);
    }

    return channel;
  }

  private async getUsers(): Promise<void> {
    const users = Object.keys(this.twitchStreamerStatus)
      .filter(
        (streamer) => this.twitchStreamerStatus[streamer].user?.id !== undefined
      )
      .map((streamer) => `id=${this.twitchStreamerStatus[streamer].user?.id}`)
      .join('&');

    if (!users) {
      return Promise.resolve();
    }

    const res = await axios.get<TwitchConfig, Twitch.Users>(
      `https://api.twitch.tv/helix/users?${users}`,
      {
        headers: {
          'Client-ID': this.twitchClientID,
          Authorization: `Bearer ${this.twitchToken}`
        }
      }
    );

    res.data.data.forEach((user) => {
      if (user?.login) {
        this.twitchStreamerStatus[user.login].user = user;
      }
    });
  }
}
