# musix-discord bot — runs the per-room voice playback + /musix slash commands.
#
# Node 22 LTS (the bot doesn't work on Node 24+ — @discordjs/voice + Node 24
# UDP timing changes caused the voice handshake to fail mid-debug; staying
# on 22 keeps the @discordjs/voice 0.19.x DAVE handshake reliable).
#
# Alpine for size. ffmpeg is the only system dep we need — @discordjs/voice
# transcodes whatever yt-dlp produces into Discord's opus voice format
# through ffmpeg. yt-dlp itself is auto-downloaded at runtime into
# /app/bin (a named volume so it survives container restarts).

FROM node:22-alpine

# ffmpeg for @discordjs/voice transcoding pipeline.
# python3 + py3-pip lets yt-dlp use its python fallback if needed
RUN apk add --no-cache ffmpeg ca-certificates python3 py3-pip

WORKDIR /app

# Install deps separately so they cache across code changes.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Source.
COPY tsconfig.json ./
COPY src ./src

# yt-dlp auto-downloads here on first /musix join. Mount as a volume in
# compose so the binary survives container rebuilds.
RUN mkdir -p /app/bin

# tsx runs the TS directly — we'd want a real build for prod-prod but
# this matches the dev workflow and the bot is small enough that the
# startup cost is invisible.
RUN npm install -D tsx@^4.19.0

ENV NODE_ENV=production

# HTTP audio proxy — see src/http-stream-server.ts. Reverse-proxy this
# port behind your own HTTPS domain in production.
EXPOSE 8080

CMD ["npx", "tsx", "src/index.ts"]
