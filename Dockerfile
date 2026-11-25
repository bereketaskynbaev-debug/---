FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY index.html server.js cloud-storage.js expanded-plans.js planner-builder.js release-guards.js open-source-links.js journal-shortcuts.js ./
COPY ktp-library.js ktp-data.json ./

EXPOSE 4180
CMD ["node", "server.js"]
