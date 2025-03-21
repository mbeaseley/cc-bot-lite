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

export default class TwitchService {
  private readonly twitchClientID = process.env.TWITCH_CLIENT_ID;
  private readonly twitchSecret = process.env.TWITCH_SECRET;
  private twitchToken = '';
  private readonly discordChannelID = process.env.DISCORD_CHANNEL_ID;
  private twitchStreamerStatus: StreamerStatus = {};

  async init(): Promise<void> {
    if (!this.twitchClientID || !this.twitchSecret) {
      throw Error(
        'Could not find Twitch client id or secret in your environment'
      );
    }

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

      const res = await axios.post<any, Twitch.TwitchToken>(
        `https://id.twitch.tv/oauth2/token?client_id=${this.twitchClientID}&client_secret=${this.twitchSecret}&grant_type=client_credentials`
      );
      this.twitchToken = res.data.access_token;
    } catch (error) {
      throw Error(String(error));
    }
  }

  async checkStreamers(): Promise<void> {
    const promises = Object.keys(this.twitchStreamerStatus).map(
      async (streamer) => {
        const res = await axios.get<any, Twitch.TwitchSteam>(
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

  public sendLiveNotifications(bot: Client): void {
    if (!this.discordChannelID) {
      throw Error('Could not find DISCORD_CHANNEL_ID in your environment');
    }

    const channel = bot.channels.cache.get(this.discordChannelID);
    if (!channel) {
      throw Error('Could not find channel');
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
            url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${stream.user_name}-1280x720.jpg`
          },
          fields: [
            {
              name: 'Game',
              value: stream?.game_name,
              inline: true
            }
          ]
        });

        // (channel as TextChannel).send(`${user?.display_name} is live now!`);

        const button = new ButtonBuilder()
          .setCustomId(`streamer-${stream.user_name}-cta`)
          .setLabel('Watch stream')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

        (channel as TextChannel).send({
          content: `**${user?.display_name}** is live now!`,
          embeds: [message],
          components: [row]
        });
      }
    });
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

    const res = await axios.get<any, Twitch.Users>(
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
