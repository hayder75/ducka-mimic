import { io, type Socket } from "socket.io-client";

export const socket: Socket = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});

export type PlayerView = {
  id: string;
  name: string;
  avatar: string;
  avatarSlot?: number;
  total: number;
  connected: boolean;
  lastScore: number | null;
};

export type SoundView = {
  id: string;
  title: string;
  subtitle?: string;
  category: string;
  url: string;
  duration: number;
  difficulty: string;
};

export type ResultView = {
  id: string;
  name: string;
  avatar: string;
  avatarSlot?: number;
  score: number;
  bonus: number;
  total: number;
  breakdown: { pitch: number; rhythm: number; sustain: number; heardNote: string } | null;
  silent: boolean;
};

export const joinUrlFor = (code: string) =>
  `${window.location.origin}/play?code=${code}`;
