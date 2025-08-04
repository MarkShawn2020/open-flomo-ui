# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flomo Garden is a Tauri-based desktop application built with React and TypeScript. It combines a Rust backend with a React frontend to create a cross-platform desktop application for managing Flomo (浮墨) notes.

## Development Commands

### Frontend Development
```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build frontend
pnpm build

# Preview production build
pnpm preview
```

### Tauri Development
```bash
# Run the full Tauri application in development mode
pnpm tauri dev

# Build the Tauri application for production
pnpm tauri build

# Run other Tauri commands
pnpm tauri [command]
```

### TypeScript
```bash
# Type checking is done automatically during build
pnpm build
```

## Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust with Tauri v2
- **Package Manager**: pnpm
- **State Management**: React Query (TanStack Query)
- **Date Handling**: date-fns
- **Code Inspector**: code-inspector-plugin for development

### Project Structure
- `/src/` - React frontend source code
  - `App.tsx` - Main React component with infinite scroll and data management
  - `ExportPreview.tsx` - Export preview dialog with format options
  - `SyncModal.tsx` - Data synchronization modal
  - `main.tsx` - Application entry point
- `/src-tauri/` - Rust backend source code
  - `src/lib.rs` - Tauri command handlers, API integration, and database operations
  - `src/db.rs` - SQLite database operations for local memo storage
  - `src/main.rs` - Application entry point
  - `tauri.conf.json` - Tauri configuration
  - `capabilities/default.json` - Tauri permissions configuration
- `/dist/` - Built frontend assets (generated)

### Key Features
- **Local Database**: SQLite database for offline memo storage and fast access
- **Data Synchronization**: Sync memos from Flomo API to local database
- **Export Options**: 
  - Multiple formats (JSON, Markdown, Table)
  - Date format customization with presets
  - URL display modes (full URL, ID only, none)
  - Minimal mode for AI consumption
- **Code Inspector**: Hold Option+Shift (Mac) or Alt+Shift (Windows) to click elements and jump to source code

### Key Configuration
- **App Identifier**: `dev.neurora.flomo-garden`
- **Frontend Dev Server**: http://localhost:1420
- **Tauri Commands**: Defined in `src-tauri/src/lib.rs` using `#[tauri::command]`
- **Frontend-Backend Communication**: Uses `@tauri-apps/api/core` invoke function
- **Permissions**: Configured in `src-tauri/capabilities/default.json`

### Important Notes
- The project uses strict TypeScript settings with no unused locals/parameters allowed
- The Rust library is named `flomo_garden_lib` to avoid Windows naming conflicts
- Tauri plugins included:
  - `tauri-plugin-opener` - Opening external links
  - `tauri-plugin-dialog` - File save dialogs
  - `tauri-plugin-fs` - File system operations
  - `tauri-plugin-store` - Configuration storage
- API authentication uses MD5 hashing for signature generation (matching Flomo's requirements)
- Debug logging is enabled in development mode - check console output for API troubleshooting
- The Flomo API endpoint `/api/v1/memo/updated/` returns memos ordered by update time, not creation time
- Frontend sorting is applied after data is loaded to allow sorting by creation date
- Export preview shows a two-column layout with original memos on the left and preview on the right
- Date formatting supports multiple presets and custom formats using date-fns tokens