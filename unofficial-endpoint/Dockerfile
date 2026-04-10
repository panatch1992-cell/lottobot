FROM denoland/deno:2.1.4

WORKDIR /app

# Copy config and server
COPY deno.json server.ts ./

# Pre-cache dependencies (including @evex/linejs from JSR)
RUN deno cache server.ts

EXPOSE 8080

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "server.ts"]
