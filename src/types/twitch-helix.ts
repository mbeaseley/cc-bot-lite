/** Twitch Helix API shapes used by the Twitch Discord service. */
export namespace Twitch {
  export interface Channel {
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
    tag_ids: string[];
    tags: string[];
    is_mature: boolean;
  }

  export interface User {
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
}

/** Helix `GET /streams` row; `tags` may be omitted on the wire. */
export type HelixStreamRow = Omit<Twitch.Channel, 'tags'> & { tags?: string[] };

export interface HelixStreamsResponse {
  data: HelixStreamRow[];
}

/** Normalizes a stream row so `tags` is always a string array (Helix may omit it). */
export function ensureStreamTags(row: HelixStreamRow): Twitch.Channel {
  return { ...row, tags: row.tags ?? [] };
}
