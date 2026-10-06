FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.cpp ./server.cpp
RUN g++ -std=c++17 -O2 -pthread server.cpp -o /app/forgefocus-ai-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 forgefocus
WORKDIR /app
COPY --from=build /app/forgefocus-ai-server ./forgefocus-ai-server
COPY index.html style.css app.js config.js ./
RUN chown -R forgefocus:forgefocus /app
USER forgefocus
ENV FORGEFOCUS_HOSTED=1
EXPOSE 8080
CMD ["./forgefocus-ai-server"]
