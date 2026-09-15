FROM docker:dind
RUN apk add --no-cache nodejs npm python3
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 4000
CMD ["npm", "start"]
