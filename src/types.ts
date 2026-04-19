export interface User {
  id: string;
  username: string;
  avatar_url: string;
  peer_id: string;
  friends: string;
  groups: string;
}

export interface Friend {
  id: string;
  username: string;
  avatar_url: string;
  peer_id: string;
  chatType: 'user';
}

export interface Group {
  id: string;
  name: string;
  avatar_url: string;
  members: string;
  chatType: 'group';
  username?: string; // For display compatibility
}

export type ChatItem = Friend | Group;

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  type: 'text' | 'sticker' | 'image' | 'video' | 'file';
  text?: string;
  file_url?: string;
  created_at: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  sender: {
    username: string;
    avatar_url: string;
  };
}
