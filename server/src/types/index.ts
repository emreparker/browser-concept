export interface User {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: Date;
  lastActivity: Date;
}

export interface Room {
  id: string;
  name: string;
  password?: string;
  users: Map<string, User>;
  currentUrl: string;
  createdAt: Date;
  lastActivity: Date;
  maxUsers: number;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'leave' | 'control' | 'sync';
  from: string;
  to?: string;
  data: any;
  timestamp: number;
}

export interface ControlMessage {
  type: 'mouse' | 'keyboard' | 'scroll' | 'click' | 'navigation';
  userId: string;
  data: any;
  timestamp: number;
}

export interface BrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  scrollPosition: { x: number; y: number };
  viewportSize: { width: number; height: number };
}
