# Dockerfile for Frontend

# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:8081
ARG VITE_LIVE_WS_URL=ws://localhost:8080/ws
ARG VITE_GOOGLE_CLIENT_ID=

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_LIVE_WS_URL=$VITE_LIVE_WS_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:1.29-alpine

# Copy built files to Nginx
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]