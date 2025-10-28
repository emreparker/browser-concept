import { v4 as uuidv4 } from 'uuid';
import { Room, User } from '../types';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private userToRoom: Map<string, string> = new Map();

  // Create a new room
  createRoom(name: string, password?: string, maxUsers: number = 10): Room {
    const roomId = uuidv4();
    const room: Room = {
      id: roomId,
      name,
      password,
      users: new Map(),
      currentUrl: 'https://www.google.com',
      createdAt: new Date(),
      lastActivity: new Date(),
      maxUsers
    };

    this.rooms.set(roomId, room);
    console.log(`🏠 Created room: ${roomId} (${name})`);

    return room;
  }

  // Join an existing room
  joinRoom(roomId: string, userId: string, userName: string, password?: string): { success: boolean; room?: Room; error?: string } {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // Check password
    if (room.password && room.password !== password) {
      return { success: false, error: 'Invalid password' };
    }

    // Check room capacity
    if (room.users.size >= room.maxUsers) {
      return { success: false, error: 'Room is full' };
    }

    // Check if user is already in room
    if (room.users.has(userId)) {
      return { success: false, error: 'User already in room' };
    }

    // Create user
    const user: User = {
      id: userId,
      name: userName,
      isHost: room.users.size === 0, // First user is host
      joinedAt: new Date(),
      lastActivity: new Date()
    };

    // Add user to room
    room.users.set(userId, user);
    room.lastActivity = new Date();

    // Map user to room
    this.userToRoom.set(userId, roomId);

    console.log(`👤 User ${userName} (${userId}) joined room ${roomId}`);
    return { success: true, room };
  }

  // Leave a room
  leaveRoom(userId: string): boolean {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return false;

    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Remove user from room
    room.users.delete(userId);
    this.userToRoom.delete(userId);

    console.log(`👋 User ${userId} left room ${roomId}`);

    // If room is empty, delete it after a delay
    if (room.users.size === 0) {
      setTimeout(() => {
        if (this.rooms.has(roomId) && this.rooms.get(roomId)!.users.size === 0) {
          this.rooms.delete(roomId);
          console.log(`🗑️ Deleted empty room: ${roomId}`);
        }
      }, 300000); // 5 minutes
    } else {
      // Update host if necessary
      const users = Array.from(room.users.values());
      if (users.length > 0 && !users.some(u => u.isHost)) {
        users[0].isHost = true;
        console.log(`👑 New host for room ${roomId}: ${users[0].id}`);
      }
    }

    return true;
  }

  // Get room by ID
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  // Get room for user
  getUserRoom(userId: string): Room | undefined {
    const roomId = this.userToRoom.get(userId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  // Get all users in a room
  getRoomUsers(roomId: string): User[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.users.values()) : [];
  }

  // Update room URL
  updateRoomUrl(roomId: string, url: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.currentUrl = url;
    room.lastActivity = new Date();
    return true;
  }

  // Update user activity
  updateUserActivity(userId: string): void {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    const user = room.users.get(userId);
    if (user) {
      user.lastActivity = new Date();
    }
    room.lastActivity = new Date();
  }

  // Get all active rooms
  getActiveRooms(): Room[] {
    return Array.from(this.rooms.values()).filter(room => room.users.size > 0);
  }

  // Clean up inactive rooms and users
  cleanup(): void {
    const now = new Date();
    const timeout = 30 * 60 * 1000; // 30 minutes

    for (const [roomId, room] of this.rooms.entries()) {
      // Remove inactive users
      for (const [userId, user] of room.users.entries()) {
        if (now.getTime() - user.lastActivity.getTime() > timeout) {
          console.log(`⏰ Removing inactive user ${userId} from room ${roomId}`);
          room.users.delete(userId);
          this.userToRoom.delete(userId);
        }
      }

      // Remove empty rooms
      if (room.users.size === 0 && now.getTime() - room.lastActivity.getTime() > timeout) {
        console.log(`⏰ Deleting inactive room: ${roomId}`);
        this.rooms.delete(roomId);
      }
    }
  }

  // Start cleanup interval
  startCleanup(): void {
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 minutes
  }
}
