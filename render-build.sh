#!/bin/bash

# Render Build Script for SimStudio
set -e

echo "🚀 Starting SimStudio build process..."

# Install Bun if not already installed
if ! command -v bun &> /dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Verify Bun installation
echo "✅ Bun version: $(bun --version)"

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Build the application
echo "🔨 Building application..."
cd apps/sim
bun run build

echo "✅ Build completed successfully!"