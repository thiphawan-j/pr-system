FROM node:22-alpine

WORKDIR /app

ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV JWT_SECRET="build-time-placeholder"
ENV APP_URL="https://pr-system.tangthong.com"
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./

RUN npm ci --include=dev --ignore-scripts

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["npm", "run", "start"]
