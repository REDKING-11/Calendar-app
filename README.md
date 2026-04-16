# 🗓️ Unified Calendar (Local-First, Multi-Source)

A self-hosted, local-first calendar that creates **one true availability view** across multiple calendars (Google, Outlook, internal), while keeping full user control.

---

## Vision

> One calendar truth. Full control. No cloud dependency.

This app is not just another calendar — it is a **decision layer** on top of all your calendars.

---

## Problem

Most users have:
- multiple calendars (work, personal, etc.)
- multiple email identities
- no unified free/busy visibility

### Result:
- double bookings
- reactive scheduling
- no protected focus time
- fragmented control

---

## Solution

A system that:
- merges all calendars into one **free/busy truth**
- lets user decide **where events are sent from**
- supports **local-first + peer-to-peer sync**
- optionally integrates with automation (IFTTT/webhooks)

---

## Architecture Overview

```mermaid
flowchart TD
    U[User] --> A[Calendar App / Master Layer]

    subgraph Connected Sources
        G[Google Calendar]
        O[Outlook Calendar]
        I[Internal Calendar]
    end

    G --> C[External Calendar Cache]
    O --> C
    I --> E[Master Events]

    A --> E
    A --> C

    E --> F[Unified Free/Busy Engine]
    C --> F

    F --> V[Single Availability View]
    F --> P[Focus Time Blocking]
    F --> S[Scheduling / Time Optimization]

    A --> N[Create Event]

    N --> D{Send from?}
    D -->|Work email| SG[Send via Outlook]
    D -->|Personal email| GG[Send via Google]
    D -->|Internal only| II[Keep only in Master Calendar]

    SG --> X1[Store external_event_id]
    GG --> X2[Store external_event_id]
    II --> X3[No external sync]

    X1 --> E
    X2 --> E
    X3 --> E

    V --> R[One Free/Busy Truth]
    P --> R
    S --> R
````

---

## Core Concepts

### 1. Master Calendar Layer

* All decisions happen here
* Stores internal events
* Syncs externally when needed

---

### 2. External Calendar Integration

* Google & Outlook are treated as:

  * read-only (for availability)
  * optional send targets (for invites)

---

### 3. Unified Free/Busy Engine

Combines:

* internal events
* external events

Into:
one availability truth

---

### 4. Event Ownership Model

Each event can be:

* internal only
* synced to Google
* synced to Outlook

```text
Master Event → Optional External Sync
```

---

### 5. Local-First Sync

Each device:

* stores full local database (SQLite)
* can work offline
* syncs changes via:

  * direct connection (LAN)
  * optional relay (temporary)

---

### 6. Change-Based Sync

Instead of syncing full data:

* only changes are exchanged

```text
Device A: "I have changes up to #1200"
Device B: "Here are #1201–1210"
```

---

### 7. Automation Hooks

Supports:

* webhooks
* IFTTT-compatible triggers

Example:

* meeting starts → lights change
* focus block → notifications muted

---

## 🚀 Roadmap

### ✅ Phase – Core Calendar (MVP)

* [ ] Local database (SQLite)
* [(Not Done but you can make em not view or edit)] Events (CRUD)
* [✔️] Day / Week / Month views
* [✔️] Color categories
* [ ] Free/busy calculation (internal only)

---

### 🔄 Phase – Multi-Calendar Support

* [ ] Import external calendars (Google, Outlook)
* [ ] Cache external events
* [ ] Merge into unified free/busy
* [ ] Prevent conflicts

---

### ✉️ Phase – Event Sending

* [ ] Select “send from” account
* [ ] Google Calendar API integration
* [ ] Microsoft Graph API integration
* [ ] Store external event IDs

---

### 🔁 Phase – Device Sync (Local-First)

* [ ] Device pairing (QR)
* [ ] Local sync (PC ↔ Phone)
* [ ] Change log system
* [ ] Delta sync (only changes)

---

### Phase 5 – Relay Sync (Optional)

* [ ] Temporary relay server
* [ ] Encrypted change buffer
* [ ] TTL-based storage (e.g. 1 hour)
* [ ] Offline catch-up sync

---

### Phase 6 – Focus & Optimization

* [ ] Focus block system
* [ ] Auto-block time slots
* [ ] “Find free slot” logic
* [ ] Smart scheduling rules (no AI)

---

### Phase 7 – Automation

* [ ] Webhook triggers
* [ ] Event-based triggers (start/end)
* [ ] MQTT / Home Assistant support
* [ ] IFTTT compatibility

---

### Phase 8 – Advanced Sync

* [ ] Conflict detection
* [ ] Last-write-wins (initial)
* [ ] Conflict resolution UI
* [ ] Multi-device mesh sync

---

## Tech Stack (Planned)

* Frontend: React / Vite
* Backend (local): Node.js or PHP
* Database (device): SQLite
* Sync: HTTP + JSON (delta-based)
* External APIs:

  * Google Calendar API
  * Microsoft Graph API

---

## Privacy & Control

* Local-first by design
* No required cloud backend
* Optional relay (ephemeral only)
* Full data ownership

---

## Product Philosophy

> This app does not just show your calendar — it helps you control it.

---

## Status

🚧 Early concept / architecture phase

---

## Contributing

Ideas, architecture feedback, and improvements welcome.