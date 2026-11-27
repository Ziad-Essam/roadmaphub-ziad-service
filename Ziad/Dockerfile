# Build from the RoadmapHub root: docker build -f Ziad/Dockerfile -t roadhub-roadmap:local .
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY shared/ ./shared/
COPY Ziad/ ./Ziad/
WORKDIR /app/Ziad
ENV PORT=3001 HOST=0.0.0.0
USER node
EXPOSE 3001
CMD ["node", "server.js"]
