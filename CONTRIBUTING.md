# Contributing to IronWaves POS Platform ⚡

Thank you for your interest in contributing to **IronWaves POS Platform**! 

IronWaves is an enterprise-grade, multi-tenant cloud Point of Sale, Kitchen Display System (KDS), and retail management platform. We are committed to building robust, resilient, and blazing-fast software that powers real-world dining and retail merchants daily.

This document outlines the guidelines, conventions, and engineering standards for contributing to the repository.

---

## 🧭 Code of Conduct

We are dedicated to providing a welcoming, inclusive, and harassment-free experience for everyone. We expect all contributors to:
- Be respectful, constructive, and empathetic in all interactions.
- Focus on what is best for the community and users of the software.
- Gracefully accept constructive feedback and prioritize technical excellence.

---

## 🛠️ Development Standards & Best Practices

To maintain our high engineering standards across over 1,450+ commits, all pull requests must comply with the following principles:

### 1. 🎨 Frontend Standards (React 19 & TypeScript)
- **Strict Type Safety**: Avoid `any` at all costs. Define strict interfaces, types, and discriminating unions in `src/types/`.
- **Touch-First Ergonomics**: POS and Waiter interfaces run on touchscreen devices (tablets, iPads, mobile phones). Interactive touch targets must measure at least **44x44px**.
- **Financial Precision**: Never use standard floating-point arithmetic for financial numbers. Use `decimal.js` for tax rates, line-item totals, split payments, and discounts.
- **Trilingual Localization (i18n)**: All new UI strings must support our three official locales:
  - 🇦🇿 **Azərbaycan dili** (`az`)
  - 🇬🇧 **English** (`en`)
  - 🇷🇺 **Русский** (`ru`)
- **Performance**: Prevent unnecessary re-renders in critical checkout paths. Keep components lightweight and modular.

### 2. ⚡ Backend Standards (FastAPI & Python 3.12+)
- **Strict Multi-Tenant Isolation**: IronWaves is a multi-tenant platform. Every query touching business data (orders, customers, products, inventory) **must enforce strict tenant isolation** via tenant context.
- **Runtime Validation**: Use Pydantic v2 models for all incoming payloads and outgoing API responses.
- **Explicit Error Handling**: Always return appropriate HTTP status codes (`400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`, `422 Unprocessable Entity`) with descriptive JSON error details.
- **Clean Architecture**: Separate route controllers (`app/routers/`) from core business logic (`app/services/`) and data models (`app/models.py`).

### 3. 🖨️ Hardware & Thermal Printing
- Ensure that ESC/POS formatting supports standard 80mm and 58mm thermal paper rolls.
- Thermal printer communications must gracefully handle offline printers or disconnected USB/Network cables without blocking the UI.

---

## 🌿 Git & Branching Workflow

We follow a structured Git branching model:

### 1. Branch Naming Convention
Branches should be lowercase and prefixed by their scope:
- `feat/<feature-name>` — New feature or capability (e.g., `feat/split-bill-by-seats`)
- `fix/<bug-name>` — Bug fix or error resolution (e.g., `fix/kds-timer-color-overflow`)
- `perf/<optimization>` — Performance improvements (e.g., `perf/pos-cart-memoization`)
- `refactor/<cleanup>` — Code refactoring without changing behavior (e.g., `refactor/settings-tabs`)
- `docs/<change>` — Documentation or guide additions (e.g., `docs/kds-hardware-guide`)
- `test/<test-suite>` — Adding or updating test suites (e.g., `test/z-report-cash-audit`)

### 2. Commit Message Etiquette
We adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification. Write clear, concise, and professional commit messages:

```text
feat(pos): add custom line-item discount modal with supervisor PIN authorization
fix(kds): prevent duplicate ticket firing on double-tap
docs(readme): update system architecture diagram and quickstart instructions
```

---

## 🚀 How to Contribute: Step-by-Step

### Step 1: Fork & Clone
1. Fork the repository on GitHub.
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/ironwaves-pos-platform.git
   cd ironwaves-pos-platform
   ```

### Step 2: Create a Feature Branch
```bash
git checkout -b feat/your-awesome-feature
```

### Step 3: Set Up Local Environment & Make Changes
Follow the [Getting Started](./README.md#getting-started) instructions to install dependencies for both frontend and backend.

### Step 4: Verify & Test Your Changes
Before opening a pull request, run the test suites and verify that the build compiles cleanly with zero errors:

```bash
# 1. Verify frontend build
npm run build

# 2. Run backend Python bytecode compile check
python3 -m compileall backend/app/

# 3. Run backend unit tests
cd backend && python3 -m pytest && cd ..

# 4. Run frontend smoke tests
npm run test:smoke
```

### Step 5: Commit & Push
```bash
git add .
git commit -m "feat(module): descriptive summary of changes"
git push origin feat/your-awesome-feature
```

### Step 6: Submit a Pull Request
1. Open a Pull Request against the `main` branch of `Enjoyer09/ironwaves-pos-platform`.
2. Provide a clear description using our PR template:
   - **Summary of Changes**: What does this PR accomplish?
   - **Motivation / Context**: Why is this change needed?
   - **Screenshots / Recordings**: (If visual UI changes were made).
   - **Verification Steps**: How did you test and verify the fix/feature?

---

## 🐛 Reporting Bugs

If you discover a bug in IronWaves:
1. Search existing [GitHub Issues](https://github.com/Enjoyer09/ironwaves-pos-platform/issues) to ensure the issue has not already been reported.
2. Open a new issue with:
   - A clear, descriptive title.
   - Exact step-by-step instructions to reproduce the bug.
   - Expected vs actual behavior.
   - Console logs, terminal outputs, or screenshots.
   - Operating system, browser, or hardware details (e.g., thermal printer model).

---

## 💡 Proposing New Features

We welcome new ideas! If you have a feature proposal or architectural recommendation:
- Open a **Feature Request** issue describing the business use case and practical value for retail/restaurant merchants.
- Detail any potential UI or API considerations.

---

## 🔒 Security & Vulnerability Reporting

Security and fiscal data privacy are paramount. If you identify a security vulnerability (such as privilege escalation, auth bypass, or data leakage):
- **Do NOT open a public GitHub issue.**
- Please report it confidentially to the maintainer via GitHub Security Advisory or direct contact.

---

## 📄 Licensing

By contributing to **IronWaves POS Platform**, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

<div align="center">
  <sub>Thank you for helping make IronWaves the world's most reliable open-source POS ecosystem! ❤️</sub>
</div>
