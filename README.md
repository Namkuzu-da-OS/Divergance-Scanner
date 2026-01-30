# Inter-Market Divergence Scanner

A real-time scanner for detecting inter-market divergences, relative strength shifts, and sector rotation signals.

## Features

- **Relative Strength Rankings** - Track performance across indices, sectors, commodities, and fixed income
- **Divergence Detection** - Correlation breakdowns and RS shifts between asset pairs
- **Sector Heatmap** - Visual representation of sector performance (1D/5D/20D/60D)
- **Real-time Alerts** - 3-tier alert system (critical/warning/info)
- **SQLite Persistence** - Alerts and divergence events stored in database

## Prerequisites

- Python 3.10+
- Node.js 18+
- A running data server with Schwab API connection (provides `/api/quotes` and `/api/history` endpoints)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Namkuzu-da-OS/Divergance-Scanner.git
cd Divergance-Scanner
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set `DATA_SERVER_URL` to your data server's IP address.

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 4. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Running

### Start the backend (from project root)

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8042 --reload
```

### Start the frontend (in a separate terminal)

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5842` (or next available port).

## Architecture

```
Data Server (Schwab API)  -->  Divergence Scanner Backend  -->  React Frontend
    :8000                           :8042                         :5842
```

The scanner does NOT connect to Schwab directly. It fetches data from your existing data server.

## API Endpoints

- `GET /api/relative-strength/rankings` - RS rankings for all symbols
- `GET /api/divergence/scan` - Active divergence signals
- `GET /api/rotation/regime` - Current market regime
- `GET /api/alerts` - Alert history
- `WS /ws` - WebSocket for real-time updates

## Symbol Universe

- **Indices**: SPY, QQQ, IWM, DIA
- **Sectors**: XLK, XLV, XLE, XLF, XLI, XLP, XLU, XLRE, XLC, XLB, XLY
- **International**: EFA, EEM
- **Commodities**: GLD, SLV, GDX, USO, UNG
- **Fixed Income**: SHY, IEF, TLT, HYG, LQD
- **Currency**: UUP
