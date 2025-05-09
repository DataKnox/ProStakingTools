FROM --platform=linux/amd64 node:latest AS build 

WORKDIR /react-app

COPY package*.json ./

COPY yarn.lock ./

RUN yarn install

COPY . .

EXPOSE 3000

# Start the React app
CMD ["yarn", "start"]