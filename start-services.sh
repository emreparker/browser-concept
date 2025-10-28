#!/bin/bash

echo "🚀 Starting Collaborative Browser Services..."
echo ""

# Function to kill process on port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port)
    if [ ! -z "$pid" ]; then
        echo "🛑 Killing process on port $port (PID: $pid)"
        kill -9 $pid
    fi
}

# Kill any existing processes on our ports
echo "🧹 Cleaning up existing processes..."
kill_port 3000
kill_port 3001
kill_port 3002
sleep 2

echo ""
echo "🔧 Starting services..."

# Start browser service (port 3002)
echo "📺 Starting Browser Service on port 3002..."
cd /Users/emrearslan/browser-concept/browser-service && npm run dev &
BROWSER_PID=$!
cd /Users/emrearslan/browser-concept

sleep 3

# Start signaling server (port 3001)
echo "📡 Starting Signaling Server on port 3001..."
cd /Users/emrearslan/browser-concept/server && npm run dev &
SERVER_PID=$!
cd /Users/emrearslan/browser-concept

sleep 3

# Start client app (port 3000)
echo "💻 Starting Client App on port 3000..."
cd /Users/emrearslan/browser-concept && npm run dev &
CLIENT_PID=$!
cd /Users/emrearslan/browser-concept

echo ""
echo "✅ All services started!"
echo ""
echo "🌐 Access your collaborative browser at:"
echo "   Main App: http://localhost:3000"
echo "   Direct Browser: http://localhost:3002/browser"
echo ""
echo "📊 Service Status:"
echo "   Browser Service (3002): $(curl -s http://localhost:3002/health | grep -o '"browserReady":[^,]*' || echo 'checking...')"
echo "   Signaling Server (3001): checking..."
echo "   Client App (3000): checking..."
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for services
trap "echo ''; echo '🛑 Stopping all services...'; kill $BROWSER_PID $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT
wait
