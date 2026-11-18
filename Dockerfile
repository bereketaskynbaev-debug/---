FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY index.html server.js expanded-plans.js planner-builder.js release-guards.js open-source-links.js journal-shortcuts.js ./

EXPOSE 4180
CMD ["node", "server.js"]
