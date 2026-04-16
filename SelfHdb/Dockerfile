FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4318

CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
