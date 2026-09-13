<div align="center">

# IronWaves POS Platform ⚡
### Enterprise Multi-Tenant Cloud Point-of-Sale, KDS & Retail ERP

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](https://opensource.org/licenses/MIT)
[![Commits](https://img.shields.io/badge/Commits-1400+-blue.svg)](https://github.com/Enjoyer09/ironwaves-pos-platform/commits/main)
[![Multi-Tenant](https://img.shields.io/badge/Architecture-Multi--Tenant-purple.svg)](https://github.com/Enjoyer09/ironwaves-pos-platform)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React--SPA-61dafb.svg)](https://react.dev/)

An open-source, production-grade point of sale, kitchen display system (KDS), and inventory ERP platform deployed in real-world retail and dining venues.

[Features](#features) · [Architecture](#architecture) · [Live Venues](#live-venues) · [Contributing](./CONTRIBUTING.md) · [License](./LICENSE)

</div>

---

## Overview

**IronWaves POS Platform** is an end-to-end, multi-tenant point of sale ecosystem developed to handle heavy transaction throughput, resilient offline/online synchronization, kitchen order routing, and detailed financial audit reporting.

With **over 1,400+ commits of continuous iterative engineering**, it powers high-tempo retail and dining merchants with rock-solid reliability.

---

## Features

- 🛒 **High-Speed Touch POS**: Rapid product lookup, barcode scanning, order modification, and multi-tender split payments.
- 🍳 **Kitchen Display System (KDS)**: Real-time ticket routing with preparation timers, course management, and station dispatch.
- 📊 **Fiscal & Financial Accounting**: Automated X/Z register shift reports, VAT breakdown, and tax ledger audits.
- 🏢 **Multi-Tenant Architecture**: Strict data isolation per tenant organization with custom role-based access control (RBAC).
- 📱 **Customer CRM & Loyalty**: QR-based customer check-in, points accumulation, and personalized promotional discounts.
- 🖨️ **Direct Hardware Printing**: Silent thermal receipt and kitchen slip generation.

---

## Architecture

- **Frontend**: Modern React single-page application with touch-first ergonomics, reactive state caching, and responsive POS layout.
- **Backend API**: High-performance FastAPI (Python) backend delivering asynchronous endpoints, WebSocket event streams, and schema validation.
- **Database & Storage**: Relational PostgreSQL with tenant isolation, atomic transaction boundaries, and automated migrations.
- **Cloud Infrastructure**: Continuous delivery and containerized microservice deployments via Railway.

---

## Live Venues & Tenant Deployments

Active operational tenants powered by the IronWaves platform:
- `socialbee.ironwaves.store`
- `emalatxana.ironwaves.store`
- `super.ironwaves.store`

---

## Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Enjoyer09/ironwaves-pos-platform.git
   cd ironwaves-pos-platform
   ```

2. **Backend Setup:**
   ```bash
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```

3. **Frontend Setup:**
   ```bash
   npm install
   npm run dev
   ```

---

## License

This project is open-source software licensed under the [MIT License](./LICENSE).

