#!/bin/bash

# Render Build Script for SimStudio
set -e

echo "🚀 Starting SimStudio build process..."

# Set performance optimizations
export NODE_OPTIONS="--max-old-space-size=1024 --max-semi-space-size=128"
export NEXT_TELEMETRY_DISABLED=1
export VERCEL_TELEMETRY_DISABLED=1

# Verify Bun installation (should be pre-installed by Render)
echo "✅ Bun version: $(bun --version)"

# Install dependencies with Bun
echo "📦 Installing dependencies with Bun..."
bun install --production --frozen-lockfile

# Show directory structure
echo "📁 Directory structure after install:"
ls -la
echo "📁 apps/sim directory:"
ls -la apps/sim/

# Install sharp for image optimization
echo "🖼️ Installing image optimization dependencies..."
cd apps/sim
bun add sharp
cd ../..

# Build the application with optimizations
echo "🔨 Building application with optimizations..."
cd apps/sim
echo "📁 Current directory before build: $(pwd)"
echo "📁 Contents before build:"
ls -la
echo "🔨 Running build command..."
bun run build
echo "📁 Contents after build:"
ls -la
echo "📁 .next directory contents:"
ls -la .next/ || echo "No .next directory found"
cd ../..

# Verify build output
if [ -d "apps/sim/.next" ]; then
    echo "✅ Build output verified: .next directory exists"
    echo "📊 Build size: $(du -sh apps/sim/.next | cut -f1)"
    echo "📁 Build contents:"
    ls -la apps/sim/.next/
else
    echo "❌ Build failed: .next directory not found"
    echo "📁 Current directory contents:"
    ls -la
    echo "📁 apps/sim directory contents:"
    ls -la apps/sim/
    exit 1
fi

echo "✅ Build completed successfully!"