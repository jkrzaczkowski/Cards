# Cards

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A web application for creating and managing educational flashcard sets. It uses LLM APIs to generate flashcard suggestions from pasted text and supports spaced repetition for effective learning.

---

## Table of Contents

- [Project Description](#project-description)
- [Tech Stack](#tech-stack)
- [Getting Started Locally](#getting-started-locally)
- [Available Scripts](#available-scripts)
- [Project Scope](#project-scope)
- [Project Status](#project-status)
- [License](#license)

---

## Project Description

**Cards** helps users quickly create and manage flashcard sets. Manual creation of high-quality flashcards is time-consuming and discourages the use of spaced repetition. This app shortens the time needed to create questions and answers and simplifies managing study material.

**Key capabilities:**

- **AI-generated flashcards** — Paste text (e.g. from a textbook); the app sends it to an LLM API and returns suggested question–answer pairs for review, edit, or rejection.
- **Manual creation and management** — Create flashcards by hand (front and back), and edit or delete existing cards in a "My flashcards" list view.
- **Authentication** — Register, log in, and delete your account and associated flashcards on request.
- **Spaced repetition** — Flashcards are scheduled for review using an integrated algorithm so you can study efficiently.
- **Privacy and compliance** — User and flashcard data stored with GDPR in mind; users can request access to and deletion of their data.

---

## Tech Stack

| Layer    | Technology | Role |
|----------|------------|------|
| **Frontend** | Astro 5 | Fast, minimal-JS pages and app shell |
| | React 19 | Interactive components |
| | TypeScript 5 | Static typing and IDE support |
| | Tailwind 4 | Styling |
| | Shadcn/ui | UI component library |
| **Backend** | Supabase | PostgreSQL database, Backend-as-a-Service, built-in auth |
| **AI** | OpenRouter.ai | Access to multiple LLM providers (OpenAI, Anthropic, Google, etc.) with API cost controls |
| **CI/CD** | GitHub Actions | Pipelines and automation |
| **Hosting** | DigitalOcean | Deployment via Docker |

---

## Getting Started Locally

### Prerequisites

- **Node.js** `v22.17.0` (see [`.nvmrc`](.nvmrc)); [nvm](https://github.com/nvm-sh/nvm) recommended:
  ```bash
  nvm use
  ```
- **npm** (included with Node.js)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/jkrzaczkowski/Cards.git
   cd Cards
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**  
   Create a `.env` (or `.env.local`) file with the variables required for Supabase and OpenRouter.ai (see project docs or `.env.example` if present).

4. **Run the development server**
   ```bash
   npm run dev
   ```
   Open the URL shown in the terminal (typically `http://localhost:4321`).

5. **Production build (optional)**
   ```bash
   npm run build
   npm run preview
   ```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Astro development server |
| `npm run build` | Build the project for production |
| `npm run preview` | Preview the production build locally |
| `npm run astro` | Run the Astro CLI directly |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |

---

## Project Scope

### In scope (MVP)

- AI-generated flashcards from pasted text (e.g. 1000–10 000 characters).
- Review, approve, edit, or reject generated cards; save selected cards.
- Manual creation, editing, and deletion of flashcards (front/back).
- User registration, login, and account (and data) deletion on request.
- Study sessions driven by a spaced-repetition algorithm.
- Statistics on AI-generated vs. accepted flashcards.
- Data handling in line with GDPR (access and deletion rights).

### Out of scope (MVP)

- Custom advanced spaced-repetition algorithm (uses an existing open-source solution).
- Gamification.
- Native mobile apps (web only).
- Document import (e.g. PDF, DOCX).
- Public API for third-party use.
- Sharing flashcard sets between users.
- Advanced notification system.
- Advanced keyword search for flashcards.

---

## Project Status

**Version:** `0.0.1`  
**Phase:** MVP / in development.

The application is being built according to the Product Requirements Document (PRD). See [`.ai/prd.md`](.ai/prd.md) for user stories, acceptance criteria, and success metrics.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
