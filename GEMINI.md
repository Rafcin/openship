# Project: Openship

## Project Overview

Openship is an order router that connects the places where you're selling to the places where you're fulfilling. It automatically routes orders from your sales channels to your fulfillment partners, giving you complete control over your order flow.

**Main Technologies:**

*   **Frontend:** Next.js 15 with App Router
*   **Backend:** KeystoneJS 6 with GraphQL API
*   **Database:** PostgreSQL with Prisma ORM
*   **Styling:** Tailwind CSS with shadcn/ui components
*   **Authentication:** Session-based with role-based permissions

**Architecture:**

*   **`app/`**: Next.js App Router, containing the admin dashboard, storefront, and API endpoints.
*   **`features/`**: Core application logic, including KeystoneJS models, GraphQL schema, and integrations.
*   **`components/`**: Shared UI components.

## Building and Running

**Prerequisites:**

*   Node.js 20+
*   PostgreSQL database
*   bun

**Setup:**

1.  **Clone and install dependencies:**
    ```bash
    git clone https://github.com/openship-org/openship.git
    cd openship
    bun install
    ```

2.  **Configure environment variables:**
    ```bash
    cp .env.example .env
    ```
    Update `.env` with your database connection string and a session secret.

3.  **Start development server:**
    ```bash
    bun run dev
    ```

**Development Commands:**

*   `bun run dev`: Build Keystone + migrate + start Next.js dev server
*   `bun run build`: Build Keystone + migrate + build Next.js for production
*   `bun run start`: Start the production Next.js server
*   `bun run lint`: Run ESLint
*   `bun run migrate:gen`: Generate and apply new database migrations
*   `bun run migrate`: Deploy existing migrations to database

## Development Conventions

*   **Coding Style:** The project uses ESLint for code linting. Run `bun run lint` to check for issues.
*   **Testing:** (TODO: Add information about testing practices if available)
*   **Contributions:** The `README.md` mentions a contributing guide. It is recommended to read it before making any changes.
