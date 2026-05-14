// Auth.js v5: the catch-all route handler just re-exports the GET/POST
// handlers produced by NextAuth() in /auth.ts. All configuration, callback
// wiring, and module augmentation lives there.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
