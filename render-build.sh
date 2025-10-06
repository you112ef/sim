#!/bin/bash

# Render Build Script for SimStudio
set -e

echo "🚀 Starting SimStudio build process..."

# Set performance optimizations
export NODE_OPTIONS="--max-old-space-size=1024 --max-semi-space-size=128"
export NEXT_TELEMETRY_DISABLED=1
export VERCEL_TELEMETRY_DISABLED=1

# Install Bun if not already installed
if ! command -v bun &> /dev/null; then
    echo "📦 Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Verify Bun installation
echo "✅ Bun version: $(bun --version)"

# Install dependencies with optimizations
echo "📦 Installing dependencies..."
bun install --production --frozen-lockfile

# Install sharp for image optimization
echo "🖼️ Installing image optimization dependencies..."
cd apps/sim
bun add sharp

# Build the application with optimizations
echo "🔨 Building application with optimizations..."
bun run build

# Verify build output
if [ -d ".next" ]; then
    echo "✅ Build output verified: .next directory exists"
    echo "📊 Build size: $(du -sh .next | cut -f1)"
else
    echo "❌ Build failed: .next directory not found"
    exit 1
fi

echo "✅ Build completed successfully!"