export {};

declare global {
  namespace Twitch {
    interface TwitchToken {
      data: {
        access_token: string;
        expires_in: number;
        token_type: string;
      };
    }

    interface Channel {
      id: string;
      user_id: string;
      user_login: string;
      user_name: string;
      game_id: string;
      game_name: string;
      type: string;
      title: string;
      viewer_count: number;
      started_at: string;
      language: string;
      thumbnail_url: string;
      tag_ids: any[];
      tags: any[];
      is_mature: boolean;
    }

    interface TwitchSteam {
      data: {
        data: Channel[];
      };
    }

    interface User {
      id?: string;
      login?: string;
      display_name?: string;
      type?: string;
      broadcaster_type?: string;
      description?: string;
      profile_image_url?: string;
      offline_image_url?: string;
      view_count?: number;
      email?: string;
      created_at?: string;
    }

    interface Users {
      data: {
        data: User[];
      };
    }
  }
}
