import axios from 'axios';
import { EmbedBuilder, TextChannel } from 'discord.js';
import { Client } from 'discordx';

const TWITCH_OAUTH_TOKEN = 'https://id.twitch.tv/oauth2/token';
const TWITCH_HELIX = 'https://api.twitch.tv/helix';
const LIVE_PREVIEW_BASE = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_';
const TWITCH_FOOTER_ICON = 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png';
/** Twitch brand purple (decimal) */
const EMBED_COLOR = 6570405;

interface StreamerState {
  user?: Twitch.User;
  live: boolean;
  stream?: Twitch.Channel;
}

type StreamerStatusMap = Record<string, StreamerState>;

interface HelixStreamsResponse {
  data: Twitch.Channel[];
}

enum TwitchErrors {
  MissingCredentials = 'Could not find Twitch client id or secret in your environment',
  MissingDiscordTextChannel = 'Could not find DISCORD_CHANNEL_ID in your environment',
  ChannelNotInCache = 'Could not find channel',
  ChannelNotText = 'Could not find valid text channel'
}

export default class TwitchService {
  private readonly clientId = process.env.TWITCH_CLIENT_ID;
  private readonly clientSecret = process.env.TWITCH_SECRET;
  private readonly discordChannelId = process.env.DISCORD_CHANNEL_ID;
  private token = '';
  private streamers: StreamerStatusMap = {};

  public async init(): Promise<void> {
    const clientId = this.clientId;
    const clientSecret = this.clientSecret;
    if (!clientId || !clientSecret) {
      throw Error(TwitchErrors.MissingCredentials);
    }

    for (const key of Object.keys(process.env)) {
      if (!key.includes('TWITCH_STREAMER_')) continue;
      const login = process.env[key];
      if (login) this.streamers[login] = { live: false };
    }

    const { data } = await axios.post<{ access_token: string }>(
      `${TWITCH_OAUTH_TOKEN}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    );
    this.token = data.access_token;
  }

  async checkStreamers(): Promise<void> {
    await Promise.all(Object.keys(this.streamers).map((login) => this.refreshStreamer(login)));
    await this.hydrateUsers();
  }

  public sendLiveNotifications(bot: Client): void {
    const channel = this.resolveAnnounceChannel(bot);

    for (const state of Object.values(this.streamers)) {
      const { user, live, stream } = state;
      if (!live || !stream || !user) continue;

      const displayName = user.display_name ?? user.login ?? 'Streamer';
      console.log('Sending notification for', displayName);

      void channel.send({
        content: `Hey @everyone, **${displayName}** is live now!`,
        embeds: [this.buildLiveEmbed(stream, user)],
        components: []
      });
    }
  }

  public checkTwitchEnvVars(): boolean {
    if (!this.clientId || !this.clientSecret) {
      throw Error(TwitchErrors.MissingCredentials);
    }
    return true;
  }

  public findLiveChannel(bot: Client): TextChannel {
    return this.resolveAnnounceChannel(bot);
  }

  private helixHeaders(): Record<string, string> {
    const id = this.clientId;
    if (!id) throw Error(TwitchErrors.MissingCredentials);
    return {
      'Client-ID': id,
      Authorization: `Bearer ${this.token}`
    };
  }

  private resolveAnnounceChannel(bot: Client): TextChannel {
    if (!this.discordChannelId) {
      throw Error(TwitchErrors.MissingDiscordTextChannel);
    }

    const channel = bot.channels.cache.get(this.discordChannelId);
    if (!channel) throw Error(TwitchErrors.ChannelNotInCache);
    if (!(channel instanceof TextChannel)) {
      throw Error(TwitchErrors.ChannelNotText);
    }
    return channel;
  }

  private async refreshStreamer(login: string): Promise<void> {
    const { data } = await axios.get<HelixStreamsResponse>(`${TWITCH_HELIX}/streams`, {
      params: { user_login: login },
      headers: this.helixHeaders()
    });

    const stream = data.data.length > 0 ? data.data[0] : undefined;
    const entry = this.streamers[login];

    if (stream !== undefined) {
      if (!entry.live) {
        this.streamers[login] = {
          user: { id: stream.user_id },
          live: true,
          stream
        };
      } else {
        entry.stream = undefined;
      }
    } else {
      entry.live = false;
    }
  }

  private buildLiveEmbed(stream: Twitch.Channel, user: Twitch.User): EmbedBuilder {
    const login = stream.user_name;
    const profileUrl = user.profile_image_url;

    return new EmbedBuilder({
      title: stream.title,
      author: {
        name: login,
        url: `https://www.twitch.tv/${login}`,
        icon_url: profileUrl
      },
      color: EMBED_COLOR,
      thumbnail: profileUrl ? { url: profileUrl } : undefined,
      image: {
        url: `${LIVE_PREVIEW_BASE}${login.toLowerCase()}-1280x720.jpg`
      },
      url: `https://www.twitch.tv/${login}`,
      fields: [
        {
          name: 'Game',
          value: stream.game_name || 'Just Chatting',
          inline: true
        },
        {
          name: 'Started',
          value: `<t:${String(Math.floor(new Date(stream.started_at).getTime() / 1000))}:R>`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Twitch', iconURL: TWITCH_FOOTER_ICON }
    });
  }

  private async hydrateUsers(): Promise<void> {
    const ids = Object.values(this.streamers)
      .map((s) => s.user?.id)
      .filter((id): id is string => Boolean(id));

    if (ids.length === 0) return;

    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
    const { data } = await axios.get<{ data: Twitch.User[] }>(`${TWITCH_HELIX}/users?${qs}`, { headers: this.helixHeaders() });

    for (const user of data.data) {
      if (user.login) {
        this.streamers[user.login].user = user;
      }
    }
  }
}
