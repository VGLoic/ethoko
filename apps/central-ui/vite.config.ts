import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { stampSourceIp } from "./source-ip.mjs";

export default defineConfig({
  plugins: [
    {
      name: "trusted-browser-source-ip",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          stampSourceIp(request);
          next();
        });
      },
    },
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
});
