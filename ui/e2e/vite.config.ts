import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
	root: import.meta.dirname,
	resolve: { dedupe: ["react", "react-dom"] },
	plugins: [
		react(),
		{
			name: "packed-product",
			configureServer(server) {
				server.middlewares.use("/product.html", (_request, response) => {
					response.setHeader("content-type", "text/html");
					response.setHeader("cache-control", "no-store");
					response.end(
						readFileSync(resolve(import.meta.dirname, "../dist/index.html"))
					);
				});
			},
		},
	],
	server: {
		host: "127.0.0.1",
		port: 4389,
		strictPort: true,
		fs: { allow: [resolve(import.meta.dirname, "../../../..")] },
	},
});
