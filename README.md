# Flomo Garden

A beautiful desktop application for managing your Flomo (浮墨) notes, built with Tauri, React, and TypeScript.

## Features

- 🔐 Secure authentication with Bearer token
- 📝 View and browse all your Flomo memos
- 🔍 Search through your memos
- 📤 Export memos in multiple formats (JSON, Markdown, Table)
- 💾 Local SQLite database for offline access
- 🔄 Sync memos from Flomo API to local storage
- 🎨 Clean and modern UI with two-column export preview
- ♾️ Infinite scrolling with React Query for optimal performance
- ⚡ Fast pagination - loads memos as you scroll
- 🔄 Sort by creation date or update date (newest/oldest first)
- 📅 Customizable date formats with presets
- 🔍 Code Inspector support for development (Option+Shift/Alt+Shift)
- 📊 Batch operations and progress tracking

## Installation

### Prerequisites

- Node.js 16+ and pnpm
- Rust 1.70+
- Platform-specific dependencies for Tauri

### Development Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd flomo-garden
```

2. Install dependencies:
```bash
pnpm install
```

3. Run in development mode:
```bash
pnpm tauri dev
```

### Building for Production

```bash
pnpm tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## Usage

### Initial Setup

1. Launch the application
2. Go to Settings tab
3. Enter your Flomo Bearer token
4. Click "Save Token"

### Getting Your Bearer Token

1. Open [Flomo web app](https://flomoapp.com)
2. Open Developer Tools (F12)
3. Go to Network tab
4. Refresh the page
5. Look for API requests to `/api/v1/memo/`
6. Find the `Authorization` header (starts with "Bearer ")
7. Copy the entire token value

### Features

- **Memos Tab**: View your memos with sorting options, infinite scroll, and export functionality
- **Search Tab**: Search through your memos by content or tags with sorting options
- **Settings Tab**: Configure your authentication token
- **Sync Data**: Synchronize your memos from Flomo API to local database

### Export Features

#### Export Formats
- **Markdown**: Human-readable format with formatting preserved
- **JSON**: Complete data export for backup or processing
- **Table**: Simple text table format

#### Export Options
- **Date Formats**: Choose from presets (yyyy-MM-dd, US format, Chinese format, etc.) or custom format
- **URL Display**: Full URL, ID only, or hide completely
- **Minimal Mode**: One-line format for AI consumption (Markdown only)
- **Compact JSON**: Minified JSON output option
- **Preview**: Live preview of export format before saving

## Technical Details

### Architecture

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust with Tauri v2
- **API Integration**: Direct HTTP calls to Flomo API
- **Storage**: Local configuration using Tauri Store plugin

### Key Technologies

- Tauri v2 for desktop app framework
- React for UI components
- TypeScript for type safety
- Rust for backend logic and API integration
- TanStack Query (React Query) for data fetching and infinite scrolling
- date-fns for date formatting

## Development

### Project Structure

```
flomo-garden/
├── src/                    # React frontend
│   ├── App.tsx            # Main application component
│   ├── ExportPreview.tsx  # Export preview dialog
│   ├── SyncModal.tsx      # Data sync modal
│   ├── App.css            # Application styles
│   └── main.tsx           # Entry point
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── lib.rs         # API integration and commands
│   │   ├── db.rs          # SQLite database operations
│   │   └── main.rs        # Application entry
│   ├── capabilities/      # Tauri permissions
│   └── tauri.conf.json    # Tauri configuration
├── vite.config.ts         # Vite configuration with code-inspector
└── package.json           # Frontend dependencies
```

### Available Commands

```bash
# Frontend development
pnpm dev          # Start Vite dev server
pnpm build        # Build frontend
pnpm preview      # Preview production build

# Tauri development
pnpm tauri dev    # Run app in development
pnpm tauri build  # Build for production
```

### Development Features

#### Code Inspector
When running in development mode (`pnpm tauri dev`), you can use the code inspector feature:
- Hold `Option + Shift` (Mac) or `Alt + Shift` (Windows/Linux)
- Hover over any element to see its information
- Click to open the source code in your editor

This feature helps you quickly navigate from UI elements to their source code.

## License

This project is licensed under the MIT License.