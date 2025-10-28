import { Server, Socket } from 'socket.io';
import io from 'socket.io-client';
import { RoomManager } from '../room/RoomManager';
import { SignalingMessage, ControlMessage } from '../types';

export class SignalingHandler {
  private io: Server;
  private roomManager: RoomManager;
  private connectedSockets: Map<string, Socket> = new Map();
  private browserSocket: any = null;

  constructor(io: Server, roomManager: RoomManager) {
    this.io = io;
    this.roomManager = roomManager;
    this.setupSocketHandlers();
    this.connectToBrowserService();
    this.setupBrowserWebRTCHandlers();
    this.startHeartbeat();
  }

  private connectToBrowserService(): void {
    console.log('🔗 Connecting to browser service...');

    this.browserSocket = io('http://localhost:3002', {
      transports: ['websocket', 'polling']
    });

    this.browserSocket.on('connect', () => {
      console.log('✅ Connected to browser service');
    });

    this.browserSocket.on('disconnect', () => {
      console.log('❌ Disconnected from browser service, attempting to reconnect...');
      setTimeout(() => this.connectToBrowserService(), 2000);
    });

    this.browserSocket.on('connect_error', (error: any) => {
      console.error('❌ Failed to connect to browser service:', error.message);
      setTimeout(() => this.connectToBrowserService(), 2000);
    });
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      this.connectedSockets.set(socket.id, socket);

      // Handle room operations
      socket.on('create-room', (data: { name: string; password?: string; maxUsers?: number }) => {
        this.handleCreateRoom(socket, data);
      });

      socket.on('join-room', (data: { roomId: string; userName: string; password?: string }) => {
        this.handleJoinRoom(socket, data);
      });

      socket.on('leave-room', () => {
        this.handleLeaveRoom(socket);
      });

      // Handle WebRTC signaling
      socket.on('webrtc-offer', (message: SignalingMessage) => {
        this.handleWebRTCOffer(socket, message);
      });

      socket.on('webrtc-answer', (message: SignalingMessage) => {
        this.handleWebRTCAnswer(socket, message);
      });

      socket.on('webrtc-ice-candidate', (message: SignalingMessage) => {
        this.handleICECandidate(socket, message);
      });

      // Handle control messages
      socket.on('control', (message: ControlMessage) => {
        this.handleControlMessage(socket, message);
      });

      socket.on('url-change', (data: { url: string }) => {
        this.handleUrlChange(socket, data);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        this.handleDisconnect(socket);
        this.connectedSockets.delete(socket.id);
      });
    });
  }

  private handleCreateRoom(socket: Socket, data: { name: string; password?: string; maxUsers?: number }): void {
    try {
      const room = this.roomManager.createRoom(data.name, data.password, data.maxUsers);

      // Join the socket to the room
      socket.join(room.id);

      socket.emit('room-created', {
        roomId: room.id,
        room: {
          id: room.id,
          name: room.name,
          currentUrl: room.currentUrl,
          userCount: room.users.size,
          maxUsers: room.maxUsers
        }
      });

    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('error', { message: 'Failed to create room' });
    }
  }

  private handleJoinRoom(socket: Socket, data: { roomId: string; userName: string; password?: string }): void {
    try {
      const result = this.roomManager.joinRoom(data.roomId, socket.id, data.userName, data.password);

      if (result.success && result.room) {
        const room = result.room;

        // Join the socket to the room
        socket.join(room.id);

        // Get user info
        const user = room.users.get(socket.id);
        const users = this.roomManager.getRoomUsers(room.id);

        // Notify the joining user
        socket.emit('room-joined', {
          roomId: room.id,
          room: {
            id: room.id,
            name: room.name,
            currentUrl: room.currentUrl,
            users: users,
            maxUsers: room.maxUsers
          },
          user: user
        });

        // Notify other users in the room
        socket.to(room.id).emit('user-joined', {
          userId: socket.id,
          user: user,
          users: users
        });

      } else {
        socket.emit('join-error', { message: result.error });
      }

    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  private handleLeaveRoom(socket: Socket): void {
    try {
      const room = this.roomManager.getUserRoom(socket.id);
      if (room) {
        this.roomManager.leaveRoom(socket.id);
        socket.leave(room.id);

        // Notify other users
        socket.to(room.id).emit('user-left', {
          userId: socket.id,
          users: this.roomManager.getRoomUsers(room.id)
        });
      }
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  }

  private handleWebRTCOffer(socket: Socket, message: SignalingMessage): void {
    const targetSocket = this.connectedSockets.get(message.to!);
    if (targetSocket) {
      targetSocket.emit('webrtc-offer', message);
    }
  }

  private handleWebRTCAnswer(socket: Socket, message: SignalingMessage): void {
    const targetSocket = this.connectedSockets.get(message.to!);
    if (targetSocket) {
      targetSocket.emit('webrtc-answer', message);
    }
  }

  private handleICECandidate(socket: Socket, message: SignalingMessage): void {
    const targetSocket = this.connectedSockets.get(message.to!);
    if (targetSocket) {
      targetSocket.emit('webrtc-ice-candidate', message);
    }
  }

  private handleControlMessage(socket: Socket, message: ControlMessage): void {
    const room = this.roomManager.getUserRoom(socket.id);
    if (room) {
      // Broadcast to all users in the room except sender
      socket.to(room.id).emit('control', message);
    }
  }

  private handleUrlChange(socket: Socket, data: { url: string }): void {
    const room = this.roomManager.getUserRoom(socket.id);
    if (room) {
      // Update room URL
      this.roomManager.updateRoomUrl(room.id, data.url);

      // Broadcast URL change to all users in the room
      this.io.to(room.id).emit('url-changed', {
        url: data.url,
        changedBy: socket.id
      });
    }
  }

  private handleDisconnect(socket: Socket): void {
    try {
      this.roomManager.leaveRoom(socket.id);

      // Notify room about disconnection
      const room = this.roomManager.getUserRoom(socket.id);
      if (room) {
        socket.to(room.id).emit('user-disconnected', {
          userId: socket.id,
          users: this.roomManager.getRoomUsers(room.id)
        });
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  }

  private startHeartbeat(): void {
    setInterval(() => {
      // Update activity for all connected users
      for (const socket of this.connectedSockets.values()) {
        this.roomManager.updateUserActivity(socket.id);
      }

      // Clean up inactive rooms
      this.roomManager.cleanup();
    }, 30000); // Every 30 seconds
  }

  // Get server statistics
  public getStats(): any {
    return {
      connectedSockets: this.connectedSockets.size,
      activeRooms: this.roomManager.getActiveRooms().length,
      rooms: this.roomManager.getActiveRooms().map(room => ({
        id: room.id,
        name: room.name,
        userCount: room.users.size,
        currentUrl: room.currentUrl
      }))
    };
  }

  private setupBrowserWebRTCHandlers(): void {
    // Create a separate namespace for browser WebRTC connections
    const browserNamespace = this.io.of('/browser-webrtc');

    browserNamespace.on('connection', (socket: Socket) => {
      console.log(`🌐 Browser WebRTC client connected: ${socket.id}`);

      // Handle WebRTC offer from browser client
      socket.on('webrtc-offer', async (data: { offer: RTCSessionDescriptionInit }) => {
        console.log('📡 Received WebRTC offer from browser client');

        if (!this.browserSocket || !this.browserSocket.connected) {
          console.error('❌ Browser service not connected');
          socket.emit('error', { message: 'Browser service not available' });
          return;
        }

        try {
          // Forward the offer to the browser service
          this.browserSocket.emit('webrtc-offer', {
            offer: data.offer,
            clientId: socket.id
          });

          // Wait for the browser service to respond with an answer
          this.browserSocket.once('webrtc-answer', (response: any) => {
            console.log('📡 Received WebRTC answer from browser service');
            socket.emit('webrtc-answer', response);
          });

        } catch (error) {
          console.error('❌ WebRTC offer handling failed:', error);
          socket.emit('error', { message: 'Failed to process WebRTC offer' });
        }
      });

      // Handle ICE candidates from browser client
      socket.on('webrtc-ice-candidate', (data: { candidate: RTCIceCandidateInit }) => {
        console.log('🧊 Received ICE candidate from browser client');

        if (this.browserSocket && this.browserSocket.connected) {
          // Forward ICE candidate to browser service
          this.browserSocket.emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            clientId: socket.id
          });
        }
      });

      // Handle browser navigation commands
      socket.on('navigate', (data: { url: string }) => {
        console.log(`🌐 Browser navigation request: ${data.url}`);

        if (this.browserSocket && this.browserSocket.connected) {
          // Forward navigation command to browser service
          this.browserSocket.emit('navigate', data);
        } else {
          console.error('❌ Cannot navigate: Browser service not connected');
          socket.emit('error', { message: 'Browser service not available' });
        }
      });

      socket.on('refresh', () => {
        console.log('🔄 Browser refresh request');

        if (this.browserSocket && this.browserSocket.connected) {
          this.browserSocket.emit('refresh');
        }
      });

      socket.on('back', () => {
        console.log('⬅️ Browser back navigation');

        if (this.browserSocket && this.browserSocket.connected) {
          this.browserSocket.emit('back');
        }
      });

      socket.on('forward', () => {
        console.log('➡️ Browser forward navigation');

        if (this.browserSocket && this.browserSocket.connected) {
          this.browserSocket.emit('forward');
        }
      });

      socket.on('disconnect', () => {
        console.log(`🌐 Browser WebRTC client disconnected: ${socket.id}`);

        // Notify browser service to clean up the connection
        if (this.browserSocket && this.browserSocket.connected) {
          this.browserSocket.emit('client-disconnected', { clientId: socket.id });
        }
      });
    });
  }
}
