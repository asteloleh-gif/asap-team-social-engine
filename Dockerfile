FROM node:24.20.0-bookworm-slim
WORKDIR /app
RUN npm install --global npm@11.19.0 --ignore-scripts --no-audit --no-fund
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN test "$(node --version)" = "v24.20.0" && test "$(npm --version)" = "11.19.0" && npm test
ENV NODE_ENV=production
ENV ASAP_LIVE_ENABLED=false
ENV ASAP_ANALYTICS_ENABLED=false
USER node
EXPOSE 3000
CMD ["node", "server-asap.js"]
