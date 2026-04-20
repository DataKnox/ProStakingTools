FROM node:20.18.0-alpine AS build

WORKDIR /app

# Build toolchain needed for node-gyp on native deps (usb, etc.) pulled in by wallet adapters.
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev libusb-dev

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY . .
RUN yarn build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
