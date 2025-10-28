#!/bin/bash

echo "🚀 Starting Collaborative Browser..."

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📁 Working directory: $SCRIPT_DIR"

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."
pkill -f "browser-service" 2>/dev/null || true
pkill -f "server.*src" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 3

# Function to check if directory exists and has package.json
check_service() {
    local service_name=$1
    local service_dir="$SCRIPT_DIR/$service_name"

    if [ ! -d "$service_dir" ]; then
        echo "❌ ERROR: Directory $service_dir does not exist!"
        return 1
    fi

    if [ ! -f "$service_dir/package.json" ]; then
        echo "❌ ERROR: package.json not found in $service_dir"
        return 1
    fi

    return 0
}

# Start services in order
echo "📡 Starting signaling server..."
if check_service "server"; then
    cd "$SCRIPT_DIR/server"
    echo "📂 Changed to: $(pwd)"
    npm run dev &
    SERVER_PID=$!
    sleep 2
else
    echo "❌ Failed to start signaling server"
    exit 1
fi

echo "🌐 Starting browser service..."
if check_service "browser-service"; then
    cd "$SCRIPT_DIR/browser-service"
    echo "📂 Changed to: $(pwd)"
    npm run dev &
    BROWSER_PID=$!
    sleep 3
else
    echo "❌ Failed to start browser service"
    exit 1
fi

echo "💻 Starting Next.js client..."
cd "$SCRIPT_DIR"
echo "📂 Changed to: $(pwd)"
if [ -f "package.json" ]; then
    npm run dev &
    CLIENT_PID=$!
    sleep 2
else
    echo "❌ ERROR: package.json not found in main directory"
    exit 1
fi

echo ""
echo "🎉 All services started!"
echo ""
echo "📋 Service URLs:"
echo "  • Main App:     http://localhost:3000"
echo "  • Browser API:  http://localhost:3002"
echo "  • Signaling:    http://localhost:3001"
echo ""
echo "💡 Open http://localhost:3000 in your browser"
echo ""
echo "⚠️  Press Ctrl+C to stop all services"

# Wait for interrupt
trap "echo '🛑 Stopping services...'; kill $SERVER_PID $BROWSER_PID $CLIENT_PID 2>/dev/null; exit" INT
wait