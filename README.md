# AI Social Media Manager

Multi-tenant SaaS platform for AI-powered social media management. Users send WhatsApp voice notes, AI generates captions and images, then publishes to Instagram/Facebook.

## Tech Stack

- **Backend:** TypeScript, Fastify, Drizzle ORM, PostgreSQL
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui
- **AI:** Mistral LLM, Groq Whisper (STT), OpenAI (image generation)
- **Payments:** Stripe (with dev mode fallback)
- **Auth:** Email/password, OAuth (Google, Facebook, GitHub)

## Quick Start

```bash
# 1. Install dependencies
npm install
cd Frontend && npm install && cd ..

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Set up database
# Create PostgreSQL database named 'ai_instagram'
# Tables are created automatically on first run

# 4. Start backend
npm run dev

# 5. Start frontend (separate terminal)
cd Frontend && npm run dev
```

Backend runs on `http://localhost:8787`, frontend on `http://localhost:5173`.

## Features

- **WhatsApp voice input** — Send a voice note, AI processes and creates a post
- **Multi-platform publishing** — Instagram, Facebook (package-based access)
- **AI content pipeline** — Intent detection, caption generation, image creation
- **Admin panel** — User management, packages, payments, settings
- **Token billing** — Configurable costs per action
- **Package system** — Feature-based platform access (Facebook Only, Starter, Pro, Exclusive)
- **OAuth login** — Google, Facebook, GitHub
- **Stripe payments** — With dev mode for local testing

## Project Structure

```
├── src/
│   ├── routes/          # API routes (webhook, auth, admin, checkout, social, stripe)
│   ├── pipeline/        # AI pipeline (generate, publish, conversation)
│   ├── lib/             # Services (instagram, facebook, tokens, auth, stripe)
│   ├── db/              # Drizzle schema
│   └── store.ts         # Database operations
├── Frontend/
│   ├── src/pages/       # React pages (Dashboard, Connect, Packages, Login, Admin/*)
│   └── src/components/  # UI components
└── tests/               # Vitest test suite
```

## Environment Variables

See [`.env.example`](.env.example) for all required configuration.

## License

Private — AI Ace One Solutions
