"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Home,
  Globe,
  Users,
  Share2,
  Settings,
  Monitor,
  UserPlus,
  Copy,
  CheckCircle
} from "lucide-react";

interface User {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: Date;
  lastActivity: Date;
}

interface Room {
  id: string;
  name: string;
  currentUrl: string;
  users: User[];
  maxUsers: number;
}

export default function CollaborativeBrowser() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("Anonymous User");
  const [inputUrl, setInputUrl] = useState("https://www.google.com");
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [showRoomDialog, setShowRoomDialog] = useState(false);
  const [browserImage, setBrowserImage] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const browserUrl = process.env.NEXT_PUBLIC_BROWSER_URL || "http://localhost:3002";

  // Initialize socket connection
  useEffect(() => {
    const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL || "http://localhost:3001";

    console.log("🔌 Connecting to signaling server:", signalingUrl);

    const newSocket = io(signalingUrl, {
      transports: ["websocket", "polling"],
      timeout: 15000,
      forceNew: true,
      upgrade: true
    });

    // Connection events
    newSocket.on("connect", () => {
      console.log("✅ Connected to signaling server");
      setIsConnected(true);
      setConnectionStatus('connected');
    });

    newSocket.on("disconnect", () => {
      console.log("❌ Disconnected from signaling server");
      setIsConnected(false);
      setConnectionStatus('disconnected');
      setCurrentRoom(null);
      setCurrentUser(null);
    });

    newSocket.on("connect_error", (error) => {
      console.error("❌ Connection error:", error);
      setConnectionStatus('disconnected');
      setIsConnected(false);
      setTimeout(() => {
        console.log("🔄 Retrying connection...");
        setConnectionStatus('connecting');
        newSocket.connect();
      }, 3000);
    });

    newSocket.on("reconnect", () => {
      console.log("🔄 Reconnected to server");
      setIsConnected(true);
      setConnectionStatus('connected');
    });

    newSocket.on("reconnect_error", (error) => {
      console.error("❌ Reconnection failed:", error);
      setConnectionStatus('disconnected');
      setIsConnected(false);
    });

    // Room events
    newSocket.on("room-created", (data) => {
      console.log("🏠 Room created successfully:", data);
      try {
        setCurrentRoom(data.room);
        // Find the user that was just created
        const user = data.room.users.find(u => u.id === newSocket.id);
        if (user) {
          setCurrentUser(user);
        } else {
          // Fallback user object
          setCurrentUser({
            id: newSocket.id,
            name: userName || 'Anonymous',
            isHost: true,
            joinedAt: new Date(),
            lastActivity: new Date()
          });
        }
        setShowRoomDialog(false);
        console.log("✅ Room setup complete");
      } catch (error) {
        console.error("Error setting up room:", error);
        alert("Room created but there was an error setting it up. Please refresh the page.");
      }
    });

    newSocket.on("room-joined", (data) => {
      console.log("🚪 Joined room successfully:", data);
      try {
        setCurrentRoom(data.room);
        setCurrentUser(data.user);
        setShowRoomDialog(false);
        console.log("✅ Room join complete");
      } catch (error) {
        console.error("Error joining room:", error);
        alert("Joined room but there was an error setting it up. Please refresh the page.");
      }
    });

    newSocket.on("join-error", (data) => {
      console.error("❌ Failed to join room:", data);
      alert(`Failed to join room: ${data.message}`);
    });

    newSocket.on("error", (error) => {
      console.error("❌ Socket error:", error);
      alert("Connection error occurred. Please refresh the page.");
    });

    newSocket.on("user-joined", (data) => {
      console.log("👤 User joined:", data);
      if (currentRoom) {
        setCurrentRoom(prev => prev ? { ...prev, users: data.users } : null);
      }
    });

    newSocket.on("user-left", (data) => {
      console.log("👋 User left:", data);
      if (currentRoom) {
        setCurrentRoom(prev => prev ? { ...prev, users: data.users } : null);
      }
    });

    newSocket.on("url-changed", (data) => {
      console.log("🔗 URL changed:", data);
      if (currentRoom) {
        setCurrentRoom(prev => prev ? { ...prev, currentUrl: data.url } : null);
        setInputUrl(data.url);
        // Update browser content
        updateBrowserContent(data.url);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  // Update browser content when URL changes
  const updateBrowserContent = useCallback(async (url: string) => {
    try {
      setIsLoading(true);

      // Navigate the browser service
      const response = await fetch(`${browserUrl}/navigate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log("✅ Browser navigated:", data);

      // Wait a moment for the page to load, then get screenshot
      setTimeout(async () => {
        await refreshBrowserImage();
        setIsLoading(false);
      }, 2000);

    } catch (error) {
      console.error("❌ Failed to navigate:", error);
      setIsLoading(false);
    }
  }, [browserUrl]);

  // Refresh browser image
  const refreshBrowserImage = useCallback(async () => {
    try {
      const response = await fetch(`${browserUrl}/screenshot`);
      if (response.ok) {
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        setBrowserImage(imageUrl);
      }
    } catch (error) {
      console.error("Failed to get screenshot:", error);
    }
  }, [browserUrl]);

  // Create a new room
  const createRoom = useCallback(() => {
    if (!socket || !isConnected) {
      alert("Not connected to server. Please wait for connection.");
      console.error("Cannot create room: socket not connected");
      return;
    }

    try {
      console.log("🏠 Creating room...");
      socket.emit("create-room", {
        name: `Room by ${userName || 'Anonymous'}`,
        maxUsers: 10
      });
    } catch (error) {
      console.error("Error creating room:", error);
      alert("Failed to create room. Please try again.");
    }
  }, [socket, isConnected, userName]);

  // Join an existing room
  const joinRoom = useCallback(() => {
    if (!socket || !isConnected) {
      alert("Not connected to server");
      return;
    }

    if (!roomId.trim()) {
      alert("Please enter a room ID");
      return;
    }

    socket.emit("join-room", {
      roomId: roomId.trim(),
      userName: userName.trim() || "Anonymous User"
    });
  }, [socket, isConnected, roomId, userName]);

  // Leave current room
  const leaveRoom = useCallback(() => {
    if (socket) {
      socket.emit("leave-room");
      setCurrentRoom(null);
      setCurrentUser(null);
    }
  }, [socket]);

  // Handle URL navigation
  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (socket && currentRoom && currentUser?.isHost) {
      socket.emit("url-change", { url: inputUrl });
      updateBrowserContent(inputUrl);
    } else if (!currentRoom) {
      updateBrowserContent(inputUrl);
    } else {
      alert("Only the host can change the URL");
    }
  }, [socket, currentRoom, currentUser, inputUrl, updateBrowserContent]);

  // Copy room link
  const copyRoomLink = useCallback(() => {
    if (currentRoom) {
      const link = `${window.location.origin}?room=${currentRoom.id}`;
      navigator.clipboard.writeText(link);
      // You could add a toast notification here
    }
  }, [currentRoom]);

  // Refresh browser image
  const handleRefresh = useCallback(() => {
    refreshBrowserImage();
  }, [refreshBrowserImage]);

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <Globe className="h-6 w-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">Collaborative Browser</h1>
          </div>

          {/* Connection Status */}
          <div className={`flex items-center gap-2 px-3 py-1 rounded-lg ${
            connectionStatus === 'connected' ? 'bg-green-50 text-green-700' :
            connectionStatus === 'connecting' ? 'bg-yellow-50 text-yellow-700' :
            'bg-red-50 text-red-700'
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500' :
              connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
              'bg-red-500'
            }`} />
            <span className="text-sm font-medium">
              {connectionStatus === 'connected' ? 'Connected' :
               connectionStatus === 'connecting' ? 'Connecting...' :
               'Disconnected'}
            </span>
          </div>

          {/* Room Status */}
          {currentRoom && (
            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-lg">
              <Users className="h-4 w-4" />
              <span className="text-sm font-medium">
                Room: {currentRoom.name} ({currentRoom.users.length}/{currentRoom.maxUsers})
                {currentUser?.isHost && <span className="ml-1">(Host)</span>}
              </span>
            </div>
          )}

          {/* Navigation Controls */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              title="Go Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              title="Refresh"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              title="Home"
            >
              <Home className="h-4 w-4" />
            </Button>
          </div>

          {/* Address Bar */}
          <form onSubmit={handleUrlSubmit} className="flex-1 max-w-2xl">
            <div className="relative">
              <Input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="Enter URL"
                className="bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500/20 rounded-lg h-10 px-4 pr-12"
              />
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                {isLoading && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                )}
              </div>
            </div>
          </form>

          {/* Room Controls */}
          <div className="flex items-center gap-2">
            {!currentRoom ? (
              <>
                <Button
                  onClick={createRoom}
                  disabled={!isConnected}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  Create Room
                </Button>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Room ID"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className="w-32 h-10 rounded-xl"
                  />
                  <Button
                    onClick={joinRoom}
                    disabled={!isConnected}
                    variant="outline"
                    className="rounded-xl"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Join
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  onClick={copyRoomLink}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  title="Copy Room Link"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
                <Button
                  onClick={leaveRoom}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-100"
                  title="Leave Room"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Interactive Browser */}
        <div className="flex-1 bg-gray-900 relative overflow-hidden">
          <iframe
            src={`${browserUrl}/browser`}
            className="w-full h-full border-0"
            title="Interactive Browser"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
          {/* Participants */}
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Participants ({currentRoom?.users.length || 0})
            </h2>
            <div className="space-y-3">
              {currentRoom?.users.map(user => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-gray-50"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {user.name}
                      {user.isHost && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Host</span>}
                    </div>
                    <div className="text-xs text-gray-500">
                      {user.id === currentUser?.id ? 'You' : 'Participant'}
                    </div>
                  </div>
                  {user.id === currentUser?.id && (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  )}
                </div>
              ))}

              {(!currentRoom || currentRoom.users.length === 0) && (
                <div className="text-center text-gray-500 py-8">
                  <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  <p>No participants yet</p>
                  <p className="text-xs mt-2">Create or join a room to get started</p>
                </div>
              )}
            </div>
          </div>

          {/* Current URL */}
          {currentRoom && (
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Current Page</h3>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600 break-all">
                  {currentRoom.currentUrl || 'No URL set'}
                </p>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="flex-1 p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">How it works:</h3>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-start gap-2">
                <span className="text-blue-500 mt-1">1.</span>
                <span>Create a room or join with a room ID</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-blue-500 mt-1">2.</span>
                <span>Host enters URLs and everyone sees the same page</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-blue-500 mt-1">3.</span>
                <span>Share the room link to invite others</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-blue-500 mt-1">4.</span>
                <span>Watch videos, browse sites together in sync</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
