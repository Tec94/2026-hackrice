import proxy from "@fastify/http-proxy";

export function registerFrontend(app, upstream) {
  app.register(proxy, {
    upstream,
    websocket: false,
    preHandler: async (request, reply) => {
      const path = request.url.split("?")[0];
      if (path === "/api" || path.startsWith("/api/") || path.startsWith("/internal/")) {
        return reply.code(404).send({ code: "not_found", requestId: request.id });
      }
    },
  });
}
