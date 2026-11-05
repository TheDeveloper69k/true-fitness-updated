FROM postgrest/postgrest:latest AS pgrst

FROM node:20-slim
WORKDIR /app
COPY --from=pgrst /bin/postgrest /usr/local/bin/postgrest
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh
ENV NODE_ENV=production
CMD ["./start.sh"]
