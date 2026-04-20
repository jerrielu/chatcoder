import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Prints the dashboard URL and the bot API target once the dev server is up.
 * Vite already logs the dashboard URL; this adds a visible line with the
 * BOT_API_URL the client was built against so the wiring is obvious at
 * launch time.
 */
function printUrls(): Plugin {
  return {
    name: "chatcoder-print-urls",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const botApi = process.env.VITE_BOT_API_URL ?? "http://127.0.0.1:8080";
        const address = server.httpServer?.address();
        const port =
          address && typeof address === "object" && "port" in address ? address.port : 5173;
        const host = server.config.server.host ?? "127.0.0.1";
        // eslint-disable-next-line no-console
        console.log(
          `\n  🧭 Dashboard: http://${host}:${port}/\n     Bot API:   ${botApi}\n`
        );
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), printUrls()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
