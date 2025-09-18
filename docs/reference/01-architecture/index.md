# Architecture Documentation

This directory contains system architecture and design documentation for Styxy.

## Documents

- **[System Design](./system-design.md)** - Comprehensive architecture and design documentation
  - Problem analysis and solution approach
  - 4-layer system architecture
  - Pure daemon approach details
  - Implementation specifications

## Architecture Overview

Styxy uses a pure daemon architecture with:

- **Background Daemon**: Single source of truth for port coordination
- **HTTP REST API**: Inter-instance communication
- **In-Memory State**: Fast allocation with filesystem persistence
- **Real-Time Monitoring**: Immediate cleanup when processes terminate
- **Service Intelligence**: Type-aware port allocation with CORE compliance