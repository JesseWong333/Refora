#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_DIR="$ROOT_DIR/native/agent-runner"
OUTPUT_DIR="$ROOT_DIR/build/agent-runner"
APP_DIR="$OUTPUT_DIR/ReforaAgentRunner.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"
mkdir -p "$MACOS_DIR"
MODULE_CACHE=$(mktemp -d "${TMPDIR:-/tmp}/refora-agent-module-cache.XXXXXX")
trap 'rm -rf "$MODULE_CACHE"' EXIT
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFT_MODULECACHE_PATH="$MODULE_CACHE" xcrun swiftc -O "$SOURCE_DIR/Broker.swift" -o "$OUTPUT_DIR/refora-agent-broker"
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE" SWIFT_MODULECACHE_PATH="$MODULE_CACHE" xcrun swiftc -O "$SOURCE_DIR/Runner.swift" -o "$MACOS_DIR/ReforaAgentRunner"
cp "$SOURCE_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
chmod 755 "$OUTPUT_DIR/refora-agent-broker" "$MACOS_DIR/ReforaAgentRunner"
codesign --force --sign - "$APP_DIR"
