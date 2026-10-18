# MediLin telehealth API
FROM node:24-slim

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

ENV PORT=8080
EXPOSE 8080

# No dependencies to install (standard library only).
CMD ["node", "src/server.js"]
