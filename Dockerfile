FROM node:20-alpine

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]    